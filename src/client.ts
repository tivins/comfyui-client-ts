import {mkdir} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {silentLogger, type Logger} from "./logger";
import type {ApiInput, ApiPrompt} from "./workflow";

export const DEFAULT_SERVER = "http://127.0.0.1:8188";

const POLL_MS = 2000;
const PROGRESS_LOG_MS = 15_000;
const TIMEOUT_MS = 30 * 60 * 1000;

type HistoryImage = {
    filename: string;
    subfolder: string;
    type: string;
};

type HistoryEntry = {
    outputs?: Record<string, { images?: HistoryImage[] }>;
    status?: {
        completed?: boolean;
        status_str?: string;
        messages?: unknown[];
    };
};

export type GenerateSettings = {
    server?: string;
    outputDir?: string;
    /** Après téléchargement, retire l'image de l'historique et le prompt de la file. Le fichier dans `output/` reste. */
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
 * Fichiers produits par les nœuds de sortie.
 *
 * Doute : seule la clé `images` est lue. Pour `SaveVideo` (Wan 2.2), la
 * vidéo est bien récupérée à l'usage, ce qui laisse penser que ComfyUI la
 * range aussi sous `images` (avec `animated`). Ce n'est pas vérifié dans
 * le code de ComfyUI : si une version la range ailleurs (`videos`, `gifs`…),
 * `runGraph` lèvera « Aucune image dans l'historique ».
 */
function collectImages(entry: HistoryEntry): HistoryImage[] {
    const images: HistoryImage[] = [];
    for (const output of Object.values(entry.outputs ?? {})) {
        for (const image of output.images ?? []) {
            images.push(image);
        }
    }
    return images;
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

async function deleteFromServer(base: string, promptId: string): Promise<void> {
    await postDelete(base, "history", promptId);
    await postDelete(base, "queue", promptId);
}

async function downloadImage(base: string, image: HistoryImage, directory: string): Promise<string> {
    const query = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder,
        type: image.type,
    });
    const response = await fetch(`${base}/view?${query}`);
    if (!response.ok) {
        throw new Error(`GET /view ${image.filename} a répondu ${response.status}`);
    }
    const target = join(directory, Date.now() + '-' + image.filename);
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
    const images = collectImages(entry);
    if (images.length === 0) {
        throw new Error(`Aucune image dans l'historique de ${promptId}`);
    }

    await mkdir(outputDir, {recursive: true});
    const paths: string[] = [];
    for (const image of images) {
        const path = await downloadImage(base, image, outputDir);
        logger.log(`[comfyui] enregistré`, path);
        paths.push(path);
    }

    if (settings.deleteFromServer) {
        await deleteFromServer(base, promptId);
        logger.log(`[comfyui] retiré de ComfyUI`, promptId);
    }

    return paths;
}
