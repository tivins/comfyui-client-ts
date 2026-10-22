import {runGraph, type GenerateSettings} from "../client";
import {uploadImage} from "../upload";
import {applyMeta, type ApiInput, type ApiPrompt} from "../workflow";
import {ColorCorrection, resizeInputs, type SeedVR2Resize} from "./seedvr2";

export const SEEDVR2_VIDEO_DEFAULTS = {
    unetName: "seedvr2_7b_int8_convrot.safetensors",
    vaeName: "seedvr2_ema_vae_fp16.safetensors",
    resize: {multiplier: 2},
    colorCorrection: ColorCorrection.Lab,
    seed: 42,
    tileSize: 512,
    tileOverlap: 128,
    framesPerChunk: 33,
} as const satisfies {
    unetName: string;
    vaeName: string;
    resize: SeedVR2Resize;
    colorCorrection: ColorCorrection;
    seed: number;
    tileSize: number;
    tileOverlap: number;
    framesPerChunk: number | null;
};

export type SeedVR2VideoOptions = {
    /** Nom de la vidéo dans le dossier `input` du serveur, tel que le renvoie `uploadImage`. */
    video: string;
    unetName: string;
    vaeName: string;
    resize: SeedVR2Resize;
    colorCorrection: ColorCorrection;
    seed: number;
    /** Tuiles spatiales du VAE (encodage et décodage), en pixels. Plus petit = moins de VRAM, plus lent. */
    tileSize: number;
    tileOverlap: number;
    /**
     * Images par morceau temporel (4n + 1 : 17, 21, 33…), ou `null` pour
     * échantillonner la vidéo d'un bloc. Les morceaux sont échantillonnés l'un
     * après l'autre, avec `CHUNK_OVERLAP` latents en commun fondus au recollage.
     * La VRAM monte avec la longueur du bloc : sur 16 Go, en ×2 depuis
     * 640 × 640, 33 images d'un bloc passent (13,6 Go) ; 81 dépasseraient
     * (~19 Go d'après la pente mesurée).
     * Une vidéo plus courte que le morceau passe d'un bloc.
     */
    framesPerChunk: number | null;
};

/**
 * Latents partagés par deux morceaux voisins (4 images chacun, sauf le
 * premier) : le recollage les fond par une fenêtre de Hann.
 */
export const CHUNK_OVERLAP = 2;

/**
 * Graphe API du modèle de workflow « Upscale Video (SeedVR2 3B Int8) »
 * (`workflows/workflow_utility_seedvr2_3b_int8_upscale_video.json`), sous-graphe
 * (66) déplié. C'est la chaîne de `buildSeedVR2Prompt`, appliquée à la vidéo :
 * SeedVR2 restaure les images ensemble (par morceaux de `framesPerChunk`),
 * et non une à une.
 *
 * La vidéo (73) est découpée en images, audio et images/s (66:74), agrandie
 * en lanczos (66:57), restaurée en un pas, puis `CreateVideo` (66:75) la
 * remonte avec les images/s, la profondeur et l'audio d'origine.
 *
 * Le modèle place deux interrupteurs : `Video Slice` (66:79, 66:81), retiré
 * car l'appelant envoie la vidéo entière, et le découpage temporel (66:102,
 * 66:103), remplacé par `framesPerChunk`, qui branche ou non 66:99 et 66:100.
 * Le modèle découpe en mode auto, d'après la VRAM libre ; mais une fois le
 * 7B chargé, il reste ~7 Gio sur 16 et le mode auto descend à une image par
 * morceau. Ici, la taille est donc fixée.
 *
 * `meta` va dans le `_meta` de l'UNET (66:52).
 */
export function buildSeedVR2VideoPrompt(options: SeedVR2VideoOptions, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const tiles = {
        tile_size: options.tileSize,
        overlap: options.tileOverlap,
        temporal_size: 64,
        temporal_overlap: 8,
    };
    // Avec le découpage, l'échantillonneur reçoit la liste des morceaux et le
    // décodeur le latent recollé ; sans, le latent entier.
    const chunked = options.framesPerChunk !== null;
    const latent: [string, number] = chunked ? ["66:99", 0] : ["66:48", 0];
    const sampled: [string, number] = chunked ? ["66:100", 0] : ["66:54", 0];
    const opts: ApiPrompt = {
        "73": {
            class_type: "LoadVideo",
            inputs: {
                file: options.video,
            },
            _meta: {}
        },
        "66:74": {
            class_type: "GetVideoComponents",
            inputs: {
                video: ["73", 0],
            },
            _meta: {}
        },
        "66:57": {
            class_type: "ResizeImageMaskNode",
            inputs: {
                ...resizeInputs(options.resize),
                scale_method: "lanczos",
                input: ["66:74", 0],
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
                vae_conditioning: latent,
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
                latent_image: latent,
            },
            _meta: {}
        },
        "66:55": {
            class_type: "VAEDecodeTiled",
            inputs: {
                ...tiles,
                samples: sampled,
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
        "66:75": {
            class_type: "CreateVideo",
            inputs: {
                fps: ["66:74", 2],
                bit_depth: ["66:74", 3],
                color_space: "sRGB",
                codec: "none",
                images: ["66:59", 0],
                audio: ["66:74", 1],
            },
            _meta: {}
        },
        "76": {
            class_type: "SaveVideo",
            inputs: {
                filename_prefix: "SeedVR2Video",
                format: "auto",
                "format.codec": "auto",
                codec: "auto",
                video: ["66:75", 0],
            },
            _meta: {}
        },
    };

    if (options.framesPerChunk !== null) {
        opts["66:99"] = {
            class_type: "SeedVR2TemporalChunk",
            inputs: {
                temporal_overlap: CHUNK_OVERLAP,
                chunking_mode: "manual",
                "chunking_mode.frames_per_chunk": options.framesPerChunk,
                latent: ["66:48", 0],
            },
            _meta: {}
        };
        opts["66:100"] = {
            class_type: "SeedVR2TemporalMerge",
            inputs: {
                latents: ["66:54", 0],
                temporal_overlap: ["66:99", 1],
            },
            _meta: {}
        };
    }

    applyMeta(opts, "66:52", meta);

    return opts;
}

/**
 * Envoie la vidéo au serveur, puis le graphe SeedVR2. Ici, `options.video`
 * est un chemin local ; il est remplacé par le nom que renvoie `uploadImage`
 * (ComfyUI y accepte aussi les vidéos).
 */
export async function generateSeedVR2VideoUpscale(options: SeedVR2VideoOptions, settings: GenerateSettings = {}): Promise<string[]> {
    const video = await uploadImage(options.video, settings);
    settings.logger?.log(`[comfyui] vidéo envoyée`, video);
    return runGraph(buildSeedVR2VideoPrompt({...options, video}, settings.meta ?? null), settings);
}
