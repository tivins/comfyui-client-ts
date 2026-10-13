import {basename} from "node:path";

import {serverBase, type GenerateSettings} from "./client";

/**
 * Envoie une image locale dans le dossier `input` de ComfyUI (`POST /upload/image`).
 * Renvoie la valeur à mettre dans `LoadImage.inputs.image`.
 *
 * Sans `overwrite`, ComfyUI réutilise un fichier identique déjà présent
 * et renomme (`nom (1).png`) un fichier différent de même nom.
 */
export async function uploadImage(path: string, settings: GenerateSettings = {}): Promise<string> {
    const base = serverBase(settings);
    const form = new FormData();
    // Un Bun.file garderait le chemin complet comme nom, que ComfyUI refuse.
    form.append("image", new File([await Bun.file(path).bytes()], basename(path)));
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
