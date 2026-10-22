import {mkdir} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {silentLogger, type Logger} from "./logger";
import type {ApiInput, ApiPrompt} from "./workflow";

export const DEFAULT_SERVER = "http://127.0.0.1:8188";

const POLL_MS = 2000;
const PROGRESS_LOG_MS = 15_000;
const TIMEOUT_MS = 30 * 60 * 1000;

type HistoryFile = {
    filename: string;
    subfolder: string;
    type: string;
};

type HistoryEntry = {
    outputs?: Record<string, { images?: HistoryFile[]; audio?: HistoryFile[] }>;
    status?: {
        completed?: boolean;
        status_str?: string;
        messages?: unknown[];
    };
};

export type GenerateSettings = {
    server?: string;
    outputDir?: string;
    /**
     * Après téléchargement, efface les fichiers du dossier `output` du serveur, puis retire le
     * prompt de l'historique et de la file. L'effacement passe par le custom node
     * `comfyui-delete-output` ; sans lui, les fichiers restent et `logger.warn` le signale.
     */
    deleteFromServer?: boolean;
    /** Suivi de la génération. Par défaut, rien n'est affiché. `console` convient. */
    logger?: Logger;
    /** Posé dans le `_meta` d'un nœud du graphe ; ComfyUI le recopie dans le chunk `prompt` des fichiers produits. */
    meta?: Record<string, ApiInput>;
};

export function serverBase(settings: GenerateSettings): string {
    return (settings.server ?? DEFAULT_SERVER).replace(/\/$/, "");
}

async function queuePrompt(base: string, prompt: ApiPrompt): Promise<string> {
    const response = await fetch(`${base}/prompt`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({prompt}),
    });
    const body = await response.json();
    if (!response.ok) {
        throw new Error(`ComfyUI a refusé le graphe (${response.status}) : ${JSON.stringify(body)}`);
    }
    const promptId = body.prompt_id;
    if (typeof promptId !== "string") {
        throw new Error(`Réponse /prompt sans prompt_id : ${JSON.stringify(body)}`);
    }
    return promptId;
}

async function waitForHistory(base: string, promptId: string, logger: Logger): Promise<HistoryEntry> {
    const started = Date.now();
    let lastLog = started;
    while (Date.now() - started < TIMEOUT_MS) {
        const response = await fetch(`${base}/history/${promptId}`);
        if (!response.ok) {
            throw new Error(`GET /history/${promptId} a répondu ${response.status}`);
        }
        const history = (await response.json()) as Record<string, HistoryEntry>;
        const entry = history[promptId];
        const now = Date.now();
        const seconds = Math.round((now - started) / 1000);
        if (entry?.status?.completed) {
            if (entry.status.status_str && entry.status.status_str !== "success") {
                throw new Error(`Génération en échec : ${JSON.stringify(entry.status)}`);
            }
            logger.log(`[comfyui] terminé (${seconds}s)`, promptId);
            return entry;
        }
        if (now - lastLog >= PROGRESS_LOG_MS) {
            logger.log(`[comfyui] en cours (${seconds}s)…`, promptId);
            lastLog = now;
        }
        await Bun.sleep(POLL_MS);
    }
    throw new Error(`Pas de résultat après ${TIMEOUT_MS / 1000}s (prompt_id ${promptId})`);
}

/**
 * Fichiers produits par les nœuds de sortie : clés `images` et `audio`.
 *
 * `SaveVideo` (Wan 2.2) range sa vidéo sous `images`, avec `animated`
 * (`PreviewVideo` dans `comfy_api/latest/_ui.py`). `SaveAudio…` (MiniMax
 * Music 3) range ses fichiers sous `audio`.
 *
 * Les fichiers `type: "input"` sont écartés : `LoadVideo` renvoie la vidéo
 * chargée en aperçu, qui n'est pas un résultat.
 */
function collectFiles(entry: HistoryEntry): HistoryFile[] {
    const files: HistoryFile[] = [];
    for (const output of Object.values(entry.outputs ?? {})) {
        files.push(...(output.images ?? []), ...(output.audio ?? []));
    }
    return files.filter((file) => file.type !== "input");
}

/** Vrai si un nœud de sortie n'a pas été réexécuté : ComfyUI a repris du cache le résultat d'un graphe identique. */
function outputsFromCache(entry: HistoryEntry): boolean {
    const cached = new Set<string>();
    for (const message of entry.status?.messages ?? []) {
        if (Array.isArray(message) && message[0] === "execution_cached") {
            for (const node of (message[1] as { nodes?: unknown[] } | undefined)?.nodes ?? []) {
                cached.add(String(node));
            }
        }
    }
    return Object.keys(entry.outputs ?? {}).some((node) => cached.has(node));
}

/** Vide l'historique des prompts terminés. La file en attente et le prompt en cours restent. */
export async function clearHistory(server: string = DEFAULT_SERVER): Promise<void> {
    const base = serverBase({server});
    const response = await fetch(`${base}/history`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({clear: true}),
    });
    if (!response.ok) {
        throw new Error(`POST /history (clear) a répondu ${response.status}`);
    }
}

async function postDelete(base: string, path: "history" | "queue", promptId: string): Promise<void> {
    const response = await fetch(`${base}/${path}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({delete: [promptId]}),
    });
    if (!response.ok) {
        throw new Error(`POST /${path} (delete ${promptId}) a répondu ${response.status}`);
    }
}

/**
 * Efface les fichiers `type: "output"` par `POST /api/output/delete` (custom node
 * `comfyui-delete-output`). Les fichiers `temp` sont laissés : ComfyUI vide ce dossier au
 * démarrage. Sans la route, ComfyUI répond 404 ou 405 : les fichiers restent, avec un
 * avertissement.
 */
async function deleteOutputFiles(base: string, files: HistoryFile[], logger: Logger): Promise<void> {
    const outputs = files.filter((file) => file.type === "output");
    if (outputs.length === 0) {
        return;
    }
    const response = await fetch(`${base}/api/output/delete`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({files: outputs}),
    });
    if (response.status === 404 || response.status === 405) {
        logger.warn(
            `[comfyui] POST /api/output/delete absent (${response.status}) : fichiers laissés dans output/. ` +
            `Custom node comfyui-delete-output installé, ComfyUI redémarré ?`,
        );
        return;
    }
    if (!response.ok) {
        throw new Error(`POST /api/output/delete a répondu ${response.status} : ${await response.text()}`);
    }
}

async function deleteFromServer(base: string, promptId: string, files: HistoryFile[], logger: Logger): Promise<void> {
    await deleteOutputFiles(base, files, logger);
    await postDelete(base, "history", promptId);
    await postDelete(base, "queue", promptId);
}

async function downloadFile(base: string, file: HistoryFile, directory: string, fromCache: boolean): Promise<string> {
    const query = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder,
        type: file.type,
    });
    const response = await fetch(`${base}/view?${query}`);
    if (!response.ok) {
        const hint = response.status === 404 && fromCache
            ? ". ComfyUI a repris du cache le résultat d'un graphe identique déjà lancé, dont le fichier a été" +
              " effacé (deleteFromServer). Changer la graine ou une autre entrée relance le graphe."
            : "";
        throw new Error(`GET /view ${file.filename} a répondu ${response.status}${hint}`);
    }
    const target = join(directory, Date.now() + '-' + file.filename);
    await Bun.write(target, await response.bytes());
    return target;
}

/**
 * Envoie un graphe API, attend la fin, et enregistre les fichiers produits
 * dans `settings.outputDir`. Renvoie leurs chemins locaux.
 */
export async function runGraph(graph: ApiPrompt, settings: GenerateSettings = {}): Promise<string[]> {
    const base = serverBase(settings);
    const logger = settings.logger ?? silentLogger;
    const outputDir =
        settings.outputDir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "output");

    const promptId = await queuePrompt(base, graph);
    logger.log(`[comfyui] en file`, promptId);

    const entry = await waitForHistory(base, promptId, logger);
    const files = collectFiles(entry);
    if (files.length === 0) {
        throw new Error(`Aucun fichier dans l'historique de ${promptId}`);
    }

    await mkdir(outputDir, {recursive: true});
    const fromCache = outputsFromCache(entry);
    const paths: string[] = [];
    for (const file of files) {
        const path = await downloadFile(base, file, outputDir, fromCache);
        logger.log(`[comfyui] enregistré`, path);
        paths.push(path);
    }

    if (settings.deleteFromServer) {
        await deleteFromServer(base, promptId, files, logger);
        logger.log(`[comfyui] retiré de ComfyUI`, promptId);
    }

    return paths;
}
