import type {Logger} from "./logger";
import type {ApiPrompt} from "./workflow";

const OPEN_TIMEOUT_MS = 5000;

/** Avancement d'une génération, reçu par `GenerateSettings.onProgress`. */
export type GenerationProgress = {
    promptId: string;
    /** Nœud en cours (id du graphe API, `"37:6"` pour un nœud de sous-graphe). */
    node: string;
    /** `class_type` du nœud en cours, `undefined` s'il n'est pas dans le graphe envoyé. */
    classType: string | undefined;
    /** Nœuds terminés, sur les nœuds à exécuter (ceux que ComfyUI reprend du cache ne comptent pas). */
    nodesDone: number;
    nodesTotal: number;
    /** Pas du nœud en cours, quand il en signale (samplers, quelques autres) ; `null` sinon. */
    step: { value: number; max: number } | null;
};

type Message = { type?: unknown; data?: Record<string, unknown> };

/**
 * Écoute le WebSocket `/ws` de ComfyUI pour un seul prompt. Les messages reçus avant que
 * `follow` donne le `prompt_id` sont gardés, puis rejoués. Les messages binaires (aperçus,
 * avec `--preview-method`) sont ignorés.
 */
export class ProgressSocket {
    private promptId: string | null = null;
    private pending: Message[] = [];
    private readonly cached = new Set<string>();
    private readonly started = new Set<string>();
    private last: GenerationProgress | null = null;
    private ended = false;
    private endSeenByPause = false;
    private wake: (() => void) | null = null;

    private constructor(
        readonly clientId: string,
        private readonly socket: WebSocket,
        private readonly graph: ApiPrompt,
        private readonly onProgress: (progress: GenerationProgress) => void,
        private readonly logger: Logger,
    ) {
        socket.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
                this.receive(event.data);
            }
        });
    }

    /** Ouvre le WebSocket ; `null` (avec `logger.warn`) si ComfyUI ne répond pas, la génération se fait alors sans suivi. */
    static async open(
        base: string,
        graph: ApiPrompt,
        onProgress: (progress: GenerationProgress) => void,
        logger: Logger,
    ): Promise<ProgressSocket | null> {
        const clientId = crypto.randomUUID();
        const url = `${base.replace(/^http/, "ws")}/ws?clientId=${clientId}`;
        let socket: WebSocket;
        try {
            socket = new WebSocket(url);
        } catch (error) {
            logger.warn(`[comfyui] WebSocket ${url} impossible, pas de suivi : ${error}`);
            return null;
        }
        const opened = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), OPEN_TIMEOUT_MS);
            socket.addEventListener("open", () => {
                clearTimeout(timer);
                resolve(true);
            });
            socket.addEventListener("error", () => {
                clearTimeout(timer);
                resolve(false);
            });
        });
        if (!opened) {
            logger.warn(`[comfyui] WebSocket ${url} injoignable, pas de suivi`);
            socket.close();
            return null;
        }
        return new ProgressSocket(clientId, socket, graph, onProgress, logger);
    }

    /** Donne le prompt à suivre et rejoue les messages reçus avant. */
    follow(promptId: string): void {
        this.promptId = promptId;
        for (const message of this.pending.splice(0)) {
            this.apply(message);
        }
    }

    /** Attend `ms`, ou moins si ComfyUI annonce la fin du prompt. */
    async pause(ms: number): Promise<void> {
        if (this.ended && !this.endSeenByPause) {
            this.endSeenByPause = true;
            return;
        }
        await Promise.race([Bun.sleep(ms), new Promise<void>((resolve) => (this.wake = resolve))]);
        this.wake = null;
    }

    /** Une fois l'historique complet, laisse arriver les derniers messages (au plus `ms`). */
    async waitForEnd(ms: number): Promise<void> {
        if (!this.ended) {
            await this.pause(ms);
        }
    }

    /** Résumé du dernier avancement, pour les messages du logger. */
    describe(): string {
        const last = this.last;
        if (!last) {
            return "";
        }
        const step = last.step ? ` ${last.step.value}/${last.step.max}` : "";
        return ` ${last.classType ?? last.node}${step}, nœud ${last.nodesDone + 1}/${last.nodesTotal}`;
    }

    close(): void {
        this.socket.close();
    }

    private receive(raw: string): void {
        let message: Message;
        try {
            message = JSON.parse(raw);
        } catch {
            return;
        }
        if (typeof message !== "object" || message === null) {
            return;
        }
        if (this.promptId === null) {
            this.pending.push(message);
        } else {
            this.apply(message);
        }
    }

    private apply({type, data}: Message): void {
        if (!data || data.prompt_id !== this.promptId) {
            return;
        }
        switch (type) {
            case "execution_cached":
                for (const node of Array.isArray(data.nodes) ? data.nodes : []) {
                    this.cached.add(String(node));
                }
                break;
            case "executing":
                if (data.node === null || data.node === undefined) {
                    this.end();
                } else {
                    this.started.add(String(data.node));
                    this.emit(String(data.node), null);
                }
                break;
            case "progress":
                if (typeof data.value === "number" && typeof data.max === "number") {
                    const node = data.node === undefined || data.node === null ? this.last?.node : String(data.node);
                    if (node !== undefined) {
                        this.started.add(node);
                        this.emit(node, {value: data.value, max: data.max});
                    }
                }
                break;
            case "execution_success":
            case "execution_error":
            case "execution_interrupted":
                this.end();
                break;
        }
    }

    private emit(node: string, step: GenerationProgress["step"]): void {
        const progress: GenerationProgress = {
            promptId: this.promptId as string,
            node,
            classType: this.graph[node]?.class_type,
            nodesDone: this.started.size - 1,
            nodesTotal: Math.max(Object.keys(this.graph).length - this.cached.size, this.started.size),
            step,
        };
        this.last = progress;
        try {
            this.onProgress(progress);
        } catch (error) {
            this.logger.warn(`[comfyui] onProgress a levé une erreur : ${error}`);
        }
    }

    private end(): void {
        this.ended = true;
        this.wake?.();
    }
}
