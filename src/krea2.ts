import { DEFAULT_SERVER, runGraph, type GenerateSettings } from "./qwen-image.ts";
import { buildKrea2Prompt, type Krea2Options } from "./workflow.ts";

/**
 * Envoie le graphe Krea 2, attend la fin, et enregistre les images.
 * `server` et `outputDir` ne font pas partie des options d'image.
 */
export async function generateKrea2(
  options: Krea2Options,
  settings: GenerateSettings = {},
): Promise<string[]> {
  const base = (settings.server ?? DEFAULT_SERVER).replace(/\/$/, "");
  const graph = buildKrea2Prompt(options);
  console.log(`serveur ${base}`);
  console.log(`prompt : ${options.prompt}`);
  console.log(`négatif : ${options.negativePrompt}`);
  console.log(`unet : ${options.unetName}`);
  console.log(`${options.width}×${options.height}, cfg ${options.cfg}`);
  console.log(
    `sampler : ${options.samplerName} / ${options.scheduler}, seed ${options.seed}, ${options.steps} steps`,
  );
  return runGraph(graph, settings);
}
