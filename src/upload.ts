import {basename} from "node:path";

import {deleteUploads, runGraph, serverBase, type GenerateSettings} from "./client";
import type {ApiPrompt} from "./workflow";

/**
 * Envoie une image locale dans le dossier `input` de ComfyUI (`POST /upload/image`).
 * Renvoie la valeur à mettre dans `LoadImage.inputs.image`.
 *
 * Sans `overwrite`, ComfyUI réutilise un fichier identique déjà présent
 * et renomme (`nom (1).png`) un fichier différent de même nom.
 *
 * Avec `settings.deleteFromServer`, le nom envoyé reçoit un préfixe unique (`cct-<8 hex>-`) :
 * deux générations qui envoient la même image ont chacune leur fichier, et l'une peut
 * effacer le sien sans casser l'autre. Le graphe change aussi à chaque envoi, ce qui évite
 * que ComfyUI ressorte de son cache un résultat dont le fichier a été effacé.
 */
export async function uploadImage(path: string, settings: GenerateSettings = {}): Promise<string> {
    const base = serverBase(settings);
    const form = new FormData();
    // Un Bun.file garderait le chemin complet comme nom, que ComfyUI refuse.
    const name = settings.deleteFromServer
        ? `cct-${crypto.randomUUID().slice(0, 8)}-${basename(path)}`
        : basename(path);
    form.append("image", new File([await Bun.file(path).bytes()], name));
    form.append("type", "input");

    const response = await fetch(`${base}/upload/image`, {method: "POST", body: form});
    if (!response.ok) {
        throw new Error(`POST /upload/image a répondu ${response.status} pour ${path}`);
    }
    const body = await response.json() as {name?: unknown; subfolder?: unknown};
    if (typeof body.name !== "string") {
        throw new Error(`Réponse /upload/image sans name : ${JSON.stringify(body)}`);
    }
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
}

/**
 * Envoie les fichiers locaux `paths` avec `uploadImage` (`null` reste `null`), construit le
 * graphe avec les noms renvoyés par le serveur, puis le lance avec `runGraph`.
 * Avec `settings.deleteFromServer`, les fichiers envoyés sont effacés du dossier `input` à la
 * fin, que la génération réussisse ou non, y compris si un envoi suivant échoue.
 */
export async function runGraphWithUploads<T extends string | null>(
    paths: readonly T[],
    settings: GenerateSettings,
    build: (names: T[]) => ApiPrompt,
): Promise<string[]> {
    const uploaded: string[] = [];
    try {
        const names: T[] = [];
        for (const path of paths) {
            if (path === null) {
                names.push(path);
                continue;
            }
            const name = await uploadImage(path, settings);
            uploaded.push(name);
            names.push(name as T);
        }
        if (uploaded.length > 0) {
            settings.logger?.log(`[comfyui] envoyé`, uploaded.join(", "));
        }
        return await runGraph(build(names), settings);
    } finally {
        if (settings.deleteFromServer && uploaded.length > 0) {
            // Un échec ici ne doit ni masquer l'erreur de la génération, ni perdre ses fichiers.
            await deleteUploads(uploaded, settings).catch((error: unknown) => {
                settings.logger?.warn(`[comfyui] envois laissés dans input/ : ${error instanceof Error ? error.message : String(error)}`);
            });
        }
    }
}
