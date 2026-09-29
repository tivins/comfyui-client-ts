import {generateQwenImage} from "./qwen-image.ts";
import {Aspect, Sampler, Scheduler, type QwenImageOptions} from "./workflow.ts";

/** Options fixées dans le programme, sans lecture des arguments ni de l'environnement. */
export const options: QwenImageOptions = {
    prompt: "a young cat walking on a table, daylight",
    negativePrompt: "blur,bad quality",
    unetName: "qwen_image_2.1_int8_convrot.safetensors",
    aspectRatio: Aspect.Standard,
    samplerName: Sampler.Euler,
    seed: 0,
    steps: 25,
    scheduler: Scheduler.Simple,
};

if (import.meta.main) {
    const catcher = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    };
    generateQwenImage(options).catch(catcher);
}
