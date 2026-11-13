import {runGraph, type GenerateSettings} from "../client";
import {uploadImage} from "../upload";
import {applyMeta, Sampler, Scheduler, type ApiInput, type ApiNode, type ApiPrompt} from "../workflow";

/** `MiniMaxH3ImageConditioning` accepte au plus 100 images. */
export const MINIMAX_H3_IMAGE_MAX_REFERENCES = 100;

/**
 * Diffusions à placer dans `models/diffusion_models/`, téléchargées par
 * `download_minimax_h3_image.sh` du dépôt comfyui.
 */
export const MiniMaxH3ImageModel = {
    /** w4a8 élaguée de Comfy-Org (12,5 Go) : tient dans 16 Go. */
    W4a8: "minimax_h3_image_pruned_w4a8.safetensors",
    /** int8 élaguée (21 Go), celle des modèles de workflow (`download_minimax_h3_image.sh int8`). */
    Int8: "minimax_h3_image_pruned_int8_convrot.safetensors",
} as const;
export type MiniMaxH3ImageModel = (typeof MiniMaxH3ImageModel)[keyof typeof MiniMaxH3ImageModel];

/** 6 pas sans CFG, euler / simple, comme les modèles de workflow ; taille choisie par le nœud. */
export const MINIMAX_H3_IMAGE_DEFAULTS = {
    referenceImages: [],
    unetName: MiniMaxH3ImageModel.W4a8,
    clipName: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    vaeName: "minimax_h3_image_vae_fp16.safetensors",
    width: 0,
    height: 0,
    samplerName: Sampler.Euler,
    scheduler: Scheduler.Simple,
    seed: 42,
    steps: 6,
} as const satisfies Omit<MiniMaxH3ImageOptions, "prompt">;

export type MiniMaxH3ImageOptions = {
    /**
     * Texte libre. Avec des images, le prompt les nomme `<Picture 1>`, `<Picture 2>`…,
     * `<Picture 1>` étant l'image à éditer.
     */
    prompt: string;
    /**
     * Images, 0 à 100. Vide : texte vers image. La première est l'image à éditer, les autres
     * des références. Pour `generateMiniMaxH3Image`, des chemins locaux ; pour
     * `buildMiniMaxH3ImagePrompt`, les noms côté serveur que renvoie `uploadImage`.
     * Le nœud les met lui-même à l'échelle (côté court entre 1024 et 2048).
     */
    referenceImages: readonly string[];
    /** Nom de fichier dans `models/diffusion_models/` ; voir `MiniMaxH3ImageModel`. */
    unetName: string;
    /** Encodeur Qwen3-VL 32B, celui de MiniMax H3 vidéo. */
    clipName: string;
    vaeName: string;
    /**
     * Multiples de 32. 0 : 2048 sans image, sinon la taille de la première image après sa mise
     * à l'échelle. Le modèle est réglé pour 2048² et rend mal sous 4 Mpx ; il va jusqu'à ~20 Mpx.
     */
    width: number;
    height: number;
    samplerName: Sampler;
    scheduler: Scheduler;
    seed: number;
    steps: number;
};

function checkReferences(count: number): void {
    if (count > MINIMAX_H3_IMAGE_MAX_REFERENCES) {
        throw new Error(`MiniMax H3 Image : ${count} images, ${MINIMAX_H3_IMAGE_MAX_REFERENCES} au plus`);
    }
}

/**
 * Graphe API des modèles de workflow « MiniMax-H3-Image: Text to Image » et « Image Edit »
 * (`image_minimax_h3_image_t2i`, `image_minimax_h3_image_edit`), sans le prompt enhancer
 * ni le redimensionnement des images en amont (le nœud le fait).
 *
 * `MiniMaxH3ImageConditioning` (5) encode le prompt avec Qwen3-VL 32B, voit les images
 * (`images.image_1`…) et, avec le VAE, les ancre en latents de référence ; il fournit aussi le
 * latent vide. Le négatif est ce conditionnement mis à zéro (6), cfg reste à 1.
 *
 * `meta` va dans le `_meta` de l'UNET (1).
 */
export function buildMiniMaxH3ImagePrompt(options: MiniMaxH3ImageOptions, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const refs = options.referenceImages;
    checkReferences(refs.length);
    const conditioning: ApiNode = {
        class_type: "MiniMaxH3ImageConditioning",
        inputs: {
            clip: ["2", 0],
            vae: ["3", 0],
            prompt: options.prompt,
            width: options.width,
            height: options.height,
        },
        _meta: {},
    };
    const graph: ApiPrompt = {
        "1": {
            class_type: "UNETLoader",
            inputs: {unet_name: options.unetName, weight_dtype: "default"},
            _meta: {},
        },
        "2": {
            class_type: "CLIPLoader",
            inputs: {clip_name: options.clipName, type: "minimax", device: "default"},
            _meta: {},
        },
        "3": {
            class_type: "VAELoader",
            inputs: {vae_name: options.vaeName},
            _meta: {},
        },
        "5": conditioning,
        "6": {
            class_type: "ConditioningZeroOut",
            inputs: {conditioning: ["5", 0]},
            _meta: {},
        },
        "7": {
            class_type: "KSampler",
            inputs: {
                model: ["1", 0],
                positive: ["5", 0],
                negative: ["6", 0],
                latent_image: ["5", 1],
                seed: options.seed,
                steps: options.steps,
                cfg: 1,
                sampler_name: options.samplerName,
                scheduler: options.scheduler,
                denoise: 1,
            },
            _meta: {},
        },
        "8": {
            class_type: "VAEDecode",
            inputs: {samples: ["7", 0], vae: ["3", 0]},
            _meta: {},
        },
        "9": {
            class_type: "SaveImage",
            inputs: {images: ["8", 0], filename_prefix: "MiniMaxH3Image"},
            _meta: {},
        },
    };

    refs.forEach((image, i) => {
        const id = String(100 + i);
        graph[id] = {class_type: "LoadImage", inputs: {image}, _meta: {}};
        conditioning.inputs[`images.image_${i + 1}`] = [id, 0];
    });

    applyMeta(graph, "1", meta);
    return graph;
}

/**
 * Envoie les images (chemins locaux) avec `uploadImage`, puis le graphe MiniMax H3 Image,
 * et enregistre les images.
 */
export async function generateMiniMaxH3Image(options: MiniMaxH3ImageOptions, settings: GenerateSettings = {}): Promise<string[]> {
    checkReferences(options.referenceImages.length);
    const referenceImages: string[] = [];
    for (const path of options.referenceImages) {
        referenceImages.push(await uploadImage(path, settings));
    }
    if (referenceImages.length > 0) {
        settings.logger?.log(`[comfyui] images envoyées`, referenceImages.join(", "));
    }
    return runGraph(buildMiniMaxH3ImagePrompt({...options, referenceImages}, settings.meta ?? null), settings);
}
