import {runGraph, type GenerateSettings} from "../client";
import {uploadImage} from "../upload";
import {applyMeta, type ApiInput, type ApiPrompt} from "../workflow";

/** Valeurs de `SeedVR2PostProcessing.color_correction_method`. */
export const ColorCorrection = {
    /** Transfert dans l'espace CIELAB, détail préservé : le plus fidèle (défaut du nœud). */
    Lab: "lab",
    /** Transfert des basses fréquences de couleur, détail agrandi gardé. */
    Wavelet: "wavelet",
    /** Moyenne et écart-type par canal : le plus rapide, teinte globale. */
    AdaIn: "adain",
    /** Pas de transfert de couleur (valeur du workflow d'exemple). */
    None: "none",
} as const;
export type ColorCorrection = (typeof ColorCorrection)[keyof typeof ColorCorrection];

/**
 * Taille de sortie, appliquée par `ResizeImageMaskNode` (lanczos) avant SeedVR2.
 * `multiplier` agrandit d'un facteur ; `longerSide` fixe le grand côté en pixels.
 * Les proportions sont gardées dans les deux cas.
 */
export type SeedVR2Resize = { multiplier: number } | { longerSide: number };

export const SEEDVR2_DEFAULTS = {
    unetName: "seedvr2_7b_int8_convrot.safetensors",
    vaeName: "seedvr2_ema_vae_fp16.safetensors",
    resize: {multiplier: 4},
    colorCorrection: ColorCorrection.Lab,
    seed: 42,
    tileSize: 512,
    tileOverlap: 128,
} as const satisfies {
    unetName: string;
    vaeName: string;
    resize: SeedVR2Resize;
    colorCorrection: ColorCorrection;
    seed: number;
    tileSize: number;
    tileOverlap: number;
};

export type SeedVR2Options = {
    /** Nom de l'image dans le dossier `input` du serveur, tel que le renvoie `uploadImage`. */
    image: string;
    unetName: string;
    vaeName: string;
    resize: SeedVR2Resize;
    colorCorrection: ColorCorrection;
    seed: number;
    /** Tuiles du VAE (encodage et décodage), en pixels. Plus petit = moins de VRAM, plus lent. */
    tileSize: number;
    tileOverlap: number;
};

function resizeInputs(resize: SeedVR2Resize): Record<string, ApiInput> {
    if ("multiplier" in resize) {
        return {resize_type: "scale by multiplier", "resize_type.multiplier": resize.multiplier};
    }
    return {resize_type: "scale longer dimension", "resize_type.longer_size": resize.longerSide};
}

/**
 * Graphe API du modèle de workflow « Agrandissement d'image : SeedVR2 7B Int8 »
 * (`docs/workflow_utility_seedvr2_7b_int8_upscale_image.json`), sans le nœud
 * `ImageCompare` qui ne sert qu'à l'interface.
 *
 * L'image (1) est d'abord agrandie en lanczos à la taille voulue (66:57), puis
 * SeedVR2 la restaure en un seul pas (`KSampler` euler / simple, cfg 1).
 * `SeedVR2PostProcessing` (66:59) réaligne le résultat sur l'image agrandie et
 * corrige ses couleurs. Encodage et décodage VAE par tuiles.
 *
 * `meta` va dans le `_meta` de l'UNET (66:52).
 */
export function buildSeedVR2Prompt(options: SeedVR2Options, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const tiles = {
        tile_size: options.tileSize,
        overlap: options.tileOverlap,
        temporal_size: 4096,
        temporal_overlap: 8,
    };
    const opts: ApiPrompt = {
        "1": {
            class_type: "LoadImage",
            inputs: {
                image: options.image,
            },
            _meta: {}
        },
        "66:50": {
            class_type: "JoinImageWithAlpha",
            inputs: {
                image: ["1", 0],
                alpha: ["1", 1],
            },
            _meta: {}
        },
        "66:57": {
            class_type: "ResizeImageMaskNode",
            inputs: {
                ...resizeInputs(options.resize),
                scale_method: "lanczos",
                input: ["66:50", 0],
            },
            _meta: {}
        },
        "66:58": {
            class_type: "SeedVR2Preprocess",
            inputs: {
                resized_images: ["66:57", 0],
            },
            _meta: {}
        },
        "66:51": {
            class_type: "VAELoader",
            inputs: {
                vae_name: options.vaeName,
            },
            _meta: {}
        },
        "66:52": {
            class_type: "UNETLoader",
            inputs: {
                unet_name: options.unetName,
                weight_dtype: "default",
            },
            _meta: {}
        },
        "66:48": {
            class_type: "VAEEncodeTiled",
            inputs: {
                ...tiles,
                pixels: ["66:58", 0],
                vae: ["66:51", 0],
            },
            _meta: {}
        },
        "66:61": {
            class_type: "SeedVR2Conditioning",
            inputs: {
                model: ["66:52", 0],
                vae_conditioning: ["66:48", 0],
            },
            _meta: {}
        },
        "66:54": {
            class_type: "KSampler",
            inputs: {
                seed: options.seed,
                steps: 1,
                cfg: 1,
                sampler_name: "euler",
                scheduler: "simple",
                denoise: 1,
                model: ["66:52", 0],
                positive: ["66:61", 0],
                negative: ["66:61", 1],
                latent_image: ["66:48", 0],
            },
            _meta: {}
        },
        "66:55": {
            class_type: "VAEDecodeTiled",
            inputs: {
                ...tiles,
                samples: ["66:54", 0],
                vae: ["66:51", 0],
            },
            _meta: {}
        },
        "66:59": {
            class_type: "SeedVR2PostProcessing",
            inputs: {
                color_correction_method: options.colorCorrection,
                images: ["66:55", 0],
                original_resized_images: ["66:57", 0],
            },
            _meta: {}
        },
        "9": {
            class_type: "SaveImage",
            inputs: {
                filename_prefix: "SeedVR2",
                images: ["66:59", 0],
            },
            _meta: {}
        },
    };

    applyMeta(opts, "66:52", meta);

    return opts;
}

/**
 * Envoie l'image au serveur, puis le graphe SeedVR2. Ici, `options.image` est
 * un chemin local ; il est remplacé par le nom que renvoie `uploadImage`.
 */
export async function generateSeedVR2Upscale(options: SeedVR2Options, settings: GenerateSettings = {}): Promise<string[]> {
    const image = await uploadImage(options.image, settings);
    settings.logger?.log(`[comfyui] image envoyée`, image);
    return runGraph(buildSeedVR2Prompt({...options, image}, settings.meta ?? null), settings);
}
