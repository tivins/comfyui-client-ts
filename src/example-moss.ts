// MOSS-Image avec placement par boîtes : une affiche, une nature morte (3 citrons placés),
// deux personnages. Prompts et boîtes dans src/example-moss.json.
// Usage : bun src/example-moss.ts [nom…]   (COMFYUI_SERVER pour un autre serveur)
import {DEFAULT_SERVER, type GenerateSettings} from "./client";
import {MOSS_IMAGE_DEFAULTS, generateMossImage, type MossBox} from "./models/moss-image";

type Example = {name: string; width: number; height: number; prompt: string; boxes: MossBox[]};
type ExampleFile = {negativePrompt: string; images: Example[]};

const settings: GenerateSettings = {
    server: process.env.COMFYUI_SERVER ?? DEFAULT_SERVER,
    outputDir: "/tmp/comfy/out",
    deleteFromServer: true,
    logger: console,
};

if (import.meta.main) {
    const file = (await Bun.file(new URL("./example-moss.json", import.meta.url)).json()) as ExampleFile;
    const wanted = process.argv.slice(2);
    for (const image of file.images.filter((i) => wanted.length === 0 || wanted.includes(i.name))) {
        const paths = await generateMossImage({
            ...MOSS_IMAGE_DEFAULTS,
            prompt: image.prompt,
            negativePrompt: file.negativePrompt,
            width: image.width,
            height: image.height,
            boxes: image.boxes,
        }, settings);
        console.log(image.name, paths);
    }
}
