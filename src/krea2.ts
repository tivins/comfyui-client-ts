import { DEFAULT_SERVER, runGraph, type GenerateSettings } from "./qwen-image";
import { buildKrea2Prompt, type Krea2Options } from "./workflow";

/**
 * Envoie le graphe Krea 2, attend la fin, et enregistre les images.
 * `server` et `outputDir` ne font pas partie des options d'image.
 */
export async function generateKrea2(
  options: Krea2Options,
  settings: GenerateSettings = {},
): Promise<string[]> {
    const graph = buildKrea2Prompt(options);
    return runGraph(graph, settings);
}
export function dumpOptionsSettings(options: Krea2Options, settings: GenerateSettings) {
    const base = (settings.server ?? DEFAULT_SERVER).replace(/\/$/, "");
    console.log(`serveur ${base}`);
    console.log(`prompt : ${options.prompt}`);
    console.log(`négatif : ${options.negativePrompt}`);
    console.log(`unet : ${options.unetName}`);
    console.log(`${options.width}×${options.height}, cfg ${options.cfg}`);
    console.log(
        `sampler : ${options.samplerName} / ${options.scheduler}, seed ${options.seed}, ${options.steps} steps`,
    );
}