import {runGraph, type GenerateSettings} from "../client";
import {uploadImage} from "../upload";
import {applyMeta, type ApiInput, type ApiPrompt} from "../workflow";

/**
 * Diffusions FL2VA (image → vidéo) à placer dans `models/diffusion_models/`,
 * téléchargées par `download_minimax_h3.sh` du dépôt comfyui.
 */
export const MiniMaxH3Model = {
    /** NVFP4 élaguée de lilcheaty (12,5 Go) : tient dans 16 Go, demande une carte Blackwell. */
    Nvfp4: "minimax_h3_fl2va_pruned_nvfp4.safetensors",
    /** int8 élaguée de Comfy-Org (21 Go), celle du modèle de workflow (`download_minimax_h3.sh int8`). */
    Int8: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
} as const;
export type MiniMaxH3Model = (typeof MiniMaxH3Model)[keyof typeof MiniMaxH3Model];

/** LoRA Turbo 8 pas de lightx2v, entraîné en 768p. */
const TURBO_LORA = "minimax_h3_fl2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors";
const TURBO_STEPS = 8;
const FPS = 24;

/** 768 × 768, 5 s, 20 pas sans Turbo : le meilleur rendu des essais sur une 5060 Ti 16 Go. */
export const MINIMAX_H3_DEFAULTS = {
    lastImage: null,
    width: 768,
    height: 768,
    seed: 42,
    duration: 5,
    steps: 20,
    turbo: false,
    unetName: MiniMaxH3Model.Nvfp4,
} as const satisfies Omit<MiniMaxH3Options, "inputImage" | "prompt">;

export type MiniMaxH3Options = {
    /**
     * Première image. Pour `buildMiniMaxH3Prompt`, nom dans le dossier `input` du serveur, tel que
     * le renvoie `uploadImage`. Pour `generateMiniMaxH3`, chemin local : l'image est envoyée avant
     * le graphe. `MiniMaxH3ImageToVideo` la met à `width` × `height` sans garder son ratio.
     */
    inputImage: string;
    /** Dernière image, même convention que `inputImage`, recadrée au centre ; `null` sans. */
    lastImage: string | null;
    /** Le modèle lit `<Picture 1>` comme l'image de départ ; une ligne `Audio:` décrit le son. */
    prompt: string;
    /** Multiples de 32. */
    width: number;
    height: number;
    seed: number;
    /** Secondes à 24 images/s, arrondies au-dessus sur la grille 17k + 5 du modèle ; voir `minimaxH3FrameCount`. */
    duration: number;
    /** Pas sans `turbo`. */
    steps: number;
    /**
     * LoRA Turbo 8 pas v1.1 768p : 8 pas, `steps` est alors ignoré. Plus de deux fois plus rapide,
     * mais les détails fins (fils de laine, yeux) se brouillent au fil de la vidéo, avec la
     * diffusion NVFP4 du moins.
     */
    turbo: boolean;
    /** Nom de fichier dans `models/diffusion_models/` ; voir `MiniMaxH3Model`. */
    unetName: string;
};

/**
 * Nombre d'images pour `duration` secondes, comme l'expression du modèle de workflow :
 * `round(duration × 24)`, au moins 5, arrondi au-dessus à 17k + 5 (5 s → 124 images).
 */
export function minimaxH3FrameCount(duration: number): number {
    const frames = Math.max(5, Math.round(duration * FPS));
    return frames + (((5 - frames) % 17) + 17) % 17;
}

/**
 * Graphe API du modèle de workflow « MiniMax H3 Image to Video »
 * (`video_minimax_h3_i2v`), sous-graphe (105) déplié.
 *
 * `MiniMaxH3ImageToVideo` (105:104) encode le prompt avec Qwen3-VL 32B et la
 * première image (114), plus la dernière (117) s'il y en a une ;
 * `SamplerCustomAdvanced` (105:14) échantillonne en `res_multistep` / `simple`
 * sans CFG (`BasicGuider`). Le latent est décodé en images par le VAE vidéo
 * (105:10) et en son stéréo 32 kHz par le VAE audio (105:23), réunis par
 * `CreateVideo` à 24 images/s. Les interrupteurs Turbo du modèle sont résolus :
 * la LoRA (105:121) n'est dans le graphe qu'avec `turbo`.
 *
 * `meta` s'ajoute au `_meta` de la première image (114).
 */
export function buildMiniMaxH3Prompt(options: MiniMaxH3Options, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const model = options.turbo ? "105:121" : "105:6";
    const opts: ApiPrompt = {
        "114": {
            inputs: {
                image: options.inputImage,
            },
            class_type: "LoadImage",
            _meta: {
                title: "Charger Image",
            },
        },
        "105:6": {
            inputs: {
                unet_name: options.unetName,
                weight_dtype: "default",
            },
            class_type: "UNETLoader",
            _meta: {},
        },
        "105:13": {
            inputs: {
                clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                type: "minimax",
                device: "default",
            },
            class_type: "CLIPLoader",
            _meta: {},
        },
        "105:11": {
            inputs: {
                vae_name: "minimax_h3_video_vae_int8_convrot.safetensors",
            },
            class_type: "VAELoader",
            _meta: {},
        },
        "105:24": {
            inputs: {
                vae_name: "minimax_h3_audio_vae_fp32.safetensors",
            },
            class_type: "VAELoader",
            _meta: {},
        },
        "105:104": {
            inputs: {
                clip: ["105:13", 0],
                vae: ["105:11", 0],
                prompt: options.prompt,
                width: options.width,
                height: options.height,
                length: minimaxH3FrameCount(options.duration),
                first_frame: ["114", 0],
            },
            class_type: "MiniMaxH3ImageToVideo",
            _meta: {},
        },
        "105:15": {
            inputs: {
                noise_seed: options.seed,
            },
            class_type: "RandomNoise",
            _meta: {},
        },
        "105:17": {
            inputs: {
                sampler_name: "res_multistep",
            },
            class_type: "KSamplerSelect",
            _meta: {},
        },
        "105:9": {
            inputs: {
                model: [model, 0],
                scheduler: "simple",
                steps: options.turbo ? TURBO_STEPS : options.steps,
                denoise: 1,
            },
            class_type: "BasicScheduler",
            _meta: {},
        },
        "105:16": {
            inputs: {
                model: [model, 0],
                conditioning: ["105:104", 0],
            },
            class_type: "BasicGuider",
            _meta: {},
        },
        "105:14": {
            inputs: {
                noise: ["105:15", 0],
                guider: ["105:16", 0],
                sampler: ["105:17", 0],
                sigmas: ["105:9", 0],
                latent_image: ["105:104", 1],
            },
            class_type: "SamplerCustomAdvanced",
            _meta: {},
        },
        "105:10": {
            inputs: {
                samples: ["105:14", 0],
                vae: ["105:11", 0],
            },
            class_type: "VAEDecode",
            _meta: {},
        },
        "105:23": {
            inputs: {
                samples: ["105:14", 0],
                vae: ["105:24", 0],
            },
            class_type: "VAEDecodeAudio",
            _meta: {},
        },
        "105:91": {
            inputs: {
                images: ["105:10", 0],
                audio: ["105:23", 0],
                fps: FPS,
            },
            class_type: "CreateVideo",
            _meta: {},
        },
        "92": {
            inputs: {
                video: ["105:91", 0],
                filename_prefix: "video/MiniMax_H3",
                format: "auto",
                codec: "auto",
            },
            class_type: "SaveVideo",
            _meta: {
                title: "Enregistrer la vidéo",
            },
        },
    };

    if (options.turbo) {
        opts["105:121"] = {
            inputs: {
                model: ["105:6", 0],
                lora_name: TURBO_LORA,
                strength_model: 1,
            },
            class_type: "LoraLoaderModelOnly",
            _meta: {},
        };
    }

    if (options.lastImage !== null) {
        opts["117"] = {
            inputs: {
                image: options.lastImage,
            },
            class_type: "LoadImage",
            _meta: {
                title: "Charger Image (dernière)",
            },
        };
        opts["105:104"]!.inputs.last_frame = ["117", 0];
    }

    applyMeta(opts, "114", meta);

    return opts;
}

/**
 * Envoie la première image (et la dernière, s'il y en a une) au serveur, puis le graphe
 * MiniMax H3, attend la fin, et enregistre la vidéo avec son son.
 * Ici, `inputImage` et `lastImage` sont des chemins locaux ; ils sont remplacés par les noms
 * que renvoie `uploadImage`.
 */
export async function generateMiniMaxH3(options: MiniMaxH3Options, settings: GenerateSettings = {}): Promise<string[]> {
    const inputImage = await uploadImage(options.inputImage, settings);
    settings.logger?.log(`[comfyui] image de départ envoyée`, inputImage);
    let lastImage: string | null = null;
    if (options.lastImage !== null) {
        lastImage = await uploadImage(options.lastImage, settings);
        settings.logger?.log(`[comfyui] dernière image envoyée`, lastImage);
    }
    return runGraph(buildMiniMaxH3Prompt({...options, inputImage, lastImage}, settings.meta ?? null), settings);
}
