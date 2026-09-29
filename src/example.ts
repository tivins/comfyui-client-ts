import {clearHistory, generateQwenImage, GenerateSettings} from "./qwen-image.ts";
import {Aspect, Sampler, Scheduler, type QwenImageOptions} from "./workflow.ts";

let options: QwenImageOptions = {
    prompt: "",
    negativePrompt: "",
    unetName: "qwen_image_2.1_int8_convrot.safetensors",
    aspectRatio: Aspect.Standard,
    samplerName: Sampler.Euler,
    seed: 0,
    steps: 25,
    scheduler: Scheduler.Simple,
};

const settings: GenerateSettings = {
    server: "http://127.0.0.1:8188",
    outputDir: "/tmp/comfy/out",
    deleteFromServer: true,
};

const prompts = [
    {
        prompt: "an old dog running in a grass field, daylight",
        negativePrompt: " ",
    },
];

if (import.meta.main) {
    const catcher = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    };

    prompts.forEach(p => {
        options.prompt = p.prompt;
        options.negativePrompt = p.negativePrompt;

        generateQwenImage(options, settings).then(paths => {
            console.log("paths=", paths);
        }).catch(catcher);
    })
    // clearHistory(settings.server);
}
