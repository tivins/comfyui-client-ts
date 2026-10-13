import { DEFAULT_SERVER, runGraph, type GenerateSettings } from "./qwen-image";
import {
    ApiInput,
    buildKrea2EditPrompt,
    buildKrea2Prompt,
    buildWan22Prompt,
    type Krea2EditOptions,
    type Krea2Options,
    Wan22Options,
} from "./workflow";
import {LoggerInterface} from "./loggerInterface";
import {uploadImage} from "./upload";

/**
 * Envoie le graphe Krea 2, attend la fin, et enregistre les images.
 * `server` et `outputDir` ne font pas partie des options d'image.
 */
export async function generateKrea2(
  options: Krea2Options,
  settings: GenerateSettings = {},
  logger: LoggerInterface|null = null,
  meta:  Record<string, ApiInput>|null = null
): Promise<string[]> {
    const graph = buildKrea2Prompt(options,meta);
    return runGraph(graph, settings, logger);
}

/**
 * Envoie l'image de référence au serveur, puis le graphe Krea 2 Identity Edit.
 * Ici, `options.referenceImage` est un chemin local ; il est remplacé par
 * le nom que renvoie `uploadImage`.
 */
export async function generateKrea2Edit(
  options: Krea2EditOptions,
  settings: GenerateSettings = {},
  logger: LoggerInterface|null = null,
  meta:  Record<string, ApiInput>|null = null
): Promise<string[]> {
    const referenceImage = await uploadImage(options.referenceImage, settings);
    if (logger) logger.log(`[comfyui] référence envoyée`, referenceImage);
    const graph = buildKrea2EditPrompt({...options, referenceImage}, meta);
    return runGraph(graph, settings, logger);
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
    console.log(`batchSize : ${options.batchSize}`);
    console.log(`LoRA count : ${options.loras.length}`);
    for (const lora of options.loras) {
        console.log(`- ${lora.model} (${lora.weight})`);
    }
}

export async function generateWan22(
    options: Wan22Options,
    settings: GenerateSettings = {},
    logger: LoggerInterface|null = null
): Promise<string[]> {
    const graph = buildWan22Prompt(options);
    return runGraph(graph, settings, logger);
}