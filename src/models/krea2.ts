import {runGraph, type GenerateSettings} from "../client";
import {runGraphWithUploads} from "../upload";
import {
    applyMeta,
    chainLoras,
    Sampler,
    Scheduler,
    type ApiInput,
    type ApiPrompt,
    type LoRA,
} from "../workflow";

export const KREA2_DEFAULTS = {
  unetName: "museByStableYogi_v35Int8Extended.safetensors",
  width: 960,
  height: 1472,
  samplerName: Sampler.Euler,
  seed: 42,
  steps: 16,
  cfg: 1.5,
  scheduler: Scheduler.Simple,
  loras: [],
  batchSize: 1
} as const satisfies {
  unetName: string;
  width: number;
  height: number;
  samplerName: Sampler;
  seed: number;
  steps: number;
  cfg: number;
  scheduler: Scheduler;
  loras: LoRA[];
  batchSize: number;
};

export type Krea2Options = {
  prompt: string;
  negativePrompt: string;
  unetName: string;
  width: number;
  height: number;
  samplerName: Sampler;
  seed: number;
  steps: number;
  cfg: number;
  scheduler: Scheduler;
  loras: LoRA[];
  batchSize: number;
};

/**
 * Graphe API du workflow UI `krea2_safetensor`.
 *
 * Deux `CLIPTextEncode` : le nœud 8 porte le prompt, le nœud 9 le négatif.
 * Le CLIP est chargé en type `krea2`. Largeur et hauteur sont fixes
 * (pas de `ResolutionSelector`). `cfg` vaut 1.5 dans l'exemple qui tourne.
 *
 * `meta` va dans le `_meta` de l'UNET (1).
 */
export function buildKrea2Prompt(options: Krea2Options, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const opts: ApiPrompt = {
        "1": {
            class_type: "UNETLoader",
            inputs: {
                unet_name: options.unetName,
                weight_dtype: "default",
            },
            _meta: {}
        },
        "7": {
            class_type: "CLIPLoader",
            inputs: {
                clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
                type: "krea2",
                device: "default",
            },
            _meta: {}
        },
        "5": {
            class_type: "VAELoader",
            inputs: {
                vae_name: "qwen_image_vae.safetensors",
            },
            _meta: {}
        },
        "8": {
            class_type: "CLIPTextEncode",
            inputs: {
                clip: ["7", 0],
                text: options.prompt,
            },
            _meta: {}
        },
        "9": {
            class_type: "CLIPTextEncode",
            inputs: {
                clip: ["7", 0],
                text: options.negativePrompt,
            },
            _meta: {}
        },
        "11": {
            class_type: "EmptyLatentImage",
            inputs: {
                width: options.width,
                height: options.height,
                batch_size: options.batchSize,
            },
            _meta: {}
        },
        "2": {
            class_type: "KSampler",
            inputs: {
                model: ["1", 0],
                positive: ["8", 0],
                negative: ["9", 0],
                latent_image: ["11", 0],
                seed: options.seed,
                steps: options.steps,
                cfg: options.cfg,
                sampler_name: options.samplerName,
                scheduler: options.scheduler,
                denoise: 1,
            },
            _meta: {}
        },
        "3": {
            class_type: "VAEDecode",
            inputs: {
                samples: ["2", 0],
                vae: ["5", 0],
            },
            _meta: {}
        },
        "4": {
            class_type: "SaveImage",
            inputs: {
                images: ["3", 0],
                filename_prefix: "Krea2",
            },
            _meta: {}
        },
    };

    applyMeta(opts, "1", meta);

    chainLoras(opts, options.loras, "1", "2", 12);

    return opts;
}

/** Valeurs de `Krea2EditModelPatch.fit_mode`. */
export const FitMode = {
  Fit: "fit",
  Crop: "crop (legacy)",
} as const;
export type FitMode = (typeof FitMode)[keyof typeof FitMode];

export const KREA2_EDIT_DEFAULTS = {
  ...KREA2_DEFAULTS,
  editLora: { model: "krea2_identity_edit_v1_2_r128.safetensors", weight: 1 },
  refBoost: 4,
  groundingPx: 768,
  fitMode: FitMode.Fit,
} as const satisfies {
  editLora: LoRA;
  refBoost: number;
  groundingPx: number;
  fitMode: FitMode;
};

export type Krea2EditOptions = Krea2Options & {
  /** Nom de l'image dans le dossier `input` du serveur, tel que le renvoie `uploadImage`. */
  referenceImage: string;
  /** LoRA d'édition, appliquée avant `loras`. Les nœuds de la LoRA en ont besoin pour lire la référence. */
  editLora: LoRA;
  /** `ref_boost` : >1 tire vers l'apparence de la référence, <1 laisse plus de liberté. */
  refBoost: number;
  /** `grounding_px` : côté max de l'image vue par Qwen3-VL. Plus haut = plus de ressemblance, plus bas = consigne mieux suivie. */
  groundingPx: number;
  fitMode: FitMode;
};

/**
 * Graphe API du workflow UI `krea2_identity_edit` (paquet `comfyui-krea2edit`),
 * exporté avec le fine-tune Muse et la LoRA Identity Edit.
 *
 * L'image de référence (72) part sur deux chemins : en latent dans
 * `Krea2EditModelPatch` (79), et dans Qwen3-VL avec la consigne par
 * `Krea2EditGroundedEncode` (84). Le négatif (85) est un second
 * `Krea2EditGroundedEncode` sur la même image ; il ne compte qu'à cfg > 1.
 * Le latent vide (82) va aussi sur `target_latent`, pour que la référence
 * soit encodée avant l'échantillonnage. Sans les nœuds du paquet, ComfyUI
 * refuse le graphe ; sans la LoRA, la référence est mal suivie.
 *
 * `meta` va dans le `_meta` de l'UNET (55).
 */
export function buildKrea2EditPrompt(options: Krea2EditOptions, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const opts: ApiPrompt = {
        "55": {
            class_type: "UNETLoader",
            inputs: {
                unet_name: options.unetName,
                weight_dtype: "default",
            },
            _meta: {}
        },
        "56": {
            class_type: "CLIPLoader",
            inputs: {
                clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
                type: "krea2",
                device: "default",
            },
            _meta: {}
        },
        "57": {
            class_type: "VAELoader",
            inputs: {
                vae_name: "qwen_image_vae.safetensors",
            },
            _meta: {}
        },
        "71": {
            class_type: "LoraLoaderModelOnly",
            inputs: {
                lora_name: options.editLora.model,
                strength_model: options.editLora.weight,
                model: ["55", 0],
            },
            _meta: {}
        },
        "72": {
            class_type: "LoadImage",
            inputs: {
                image: options.referenceImage,
            },
            _meta: {}
        },
        "73": {
            class_type: "VAEEncode",
            inputs: {
                pixels: ["72", 0],
                vae: ["57", 0],
            },
            _meta: {}
        },
        "82": {
            class_type: "EmptySD3LatentImage",
            inputs: {
                width: options.width,
                height: options.height,
                batch_size: options.batchSize,
            },
            _meta: {}
        },
        "79": {
            class_type: "Krea2EditModelPatch",
            inputs: {
                model: ["71", 0],
                source_latent: ["73", 0],
                vae: ["57", 0],
                source_image: ["72", 0],
                target_latent: ["82", 0],
                ref_boost: options.refBoost,
                ref_boost_a: 1,
                fit_mode: options.fitMode,
            },
            _meta: {}
        },
        "84": {
            class_type: "Krea2EditGroundedEncode",
            inputs: {
                clip: ["56", 0],
                image: ["72", 0],
                prompt: options.prompt,
                grounding_px: options.groundingPx,
                system_prompt: "",
            },
            _meta: {}
        },
        "85": {
            class_type: "Krea2EditGroundedEncode",
            inputs: {
                clip: ["56", 0],
                image: ["72", 0],
                prompt: options.negativePrompt,
                grounding_px: options.groundingPx,
                system_prompt: "",
            },
            _meta: {}
        },
        "53": {
            class_type: "KSampler",
            inputs: {
                model: ["79", 0],
                positive: ["84", 0],
                negative: ["85", 0],
                latent_image: ["82", 0],
                seed: options.seed,
                steps: options.steps,
                cfg: options.cfg,
                sampler_name: options.samplerName,
                scheduler: options.scheduler,
                denoise: 1,
            },
            _meta: {}
        },
        "54": {
            class_type: "VAEDecode",
            inputs: {
                samples: ["53", 0],
                vae: ["57", 0],
            },
            _meta: {}
        },
        "29": {
            class_type: "SaveImage",
            inputs: {
                images: ["54", 0],
                filename_prefix: "Krea2Edit",
            },
            _meta: {}
        },
    };

    applyMeta(opts, "55", meta);

    chainLoras(opts, options.loras, "71", "79", 86);

    return opts;
}

/** Envoie le graphe Krea 2, attend la fin, et enregistre les images. */
export async function generateKrea2(options: Krea2Options, settings: GenerateSettings = {}): Promise<string[]> {
    return runGraph(buildKrea2Prompt(options, settings.meta ?? null), settings);
}

/**
 * Envoie l'image de référence au serveur, puis le graphe Krea 2 Identity Edit.
 * Ici, `options.referenceImage` est un chemin local ; il est remplacé par
 * le nom que renvoie `uploadImage`.
 */
export async function generateKrea2Edit(options: Krea2EditOptions, settings: GenerateSettings = {}): Promise<string[]> {
    return runGraphWithUploads([options.referenceImage], settings,
        ([referenceImage]) => buildKrea2EditPrompt({...options, referenceImage: referenceImage!}, settings.meta ?? null));
}
