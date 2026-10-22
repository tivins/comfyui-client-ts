import {runGraph, type GenerateSettings} from "../client";
import {uploadImage} from "../upload";
import {applyMeta, type ApiInput, type ApiPrompt} from "../workflow";

/**
 * Fichiers du dépôt Comfy-Org/frame_interpolation, à placer dans
 * `models/frame_interpolation/`. `FrameInterpolationModelLoader` reconnaît
 * RIFE ou FILM d'après les poids.
 */
export const FrameInterpolationModel = {
    /** RIFE 4.26 (23 Mo) : rapide. */
    Rife426: "rife_v4.26.safetensors",
    Rife426Heavy: "rife_v4.26_heavy.safetensors",
    Rife425: "rife_v4.25.safetensors",
    Rife425Heavy: "rife_v4.25_heavy.safetensors",
    Rife425Lite: "rife_v4.25_lite.safetensors",
    /** FILM fp16 (69 Mo) : plus lent, fait pour les grands mouvements. */
    Film: "film_net_fp16.safetensors",
} as const;
export type FrameInterpolationModel = (typeof FrameInterpolationModel)[keyof typeof FrameInterpolationModel];

export const FRAME_INTERPOLATION_DEFAULTS = {
    modelName: FrameInterpolationModel.Rife426,
    multiplier: 2,
} as const satisfies {
    modelName: string;
    multiplier: number;
};

export type FrameInterpolationOptions = {
    /** Nom de la vidéo dans le dossier `input` du serveur, tel que le renvoie `uploadImage`. */
    video: string;
    /** Nom de fichier dans `models/frame_interpolation/` ; voir `FrameInterpolationModel`. */
    modelName: string;
    /**
     * Entier de 2 à 16 : n images deviennent `(n - 1) × multiplier + 1`, et
     * les images/s sont multipliées d'autant (16 → 32 avec 2).
     */
    multiplier: number;
};

/**
 * Graphe API du modèle de workflow « Frame Interpolation: FILM or RIFE »
 * (`utility_video_frame_interpolation`), sous-graphe (16) déplié. Le modèle
 * place un interrupteur pour garder les images/s d'origine (ralenti) ; ici,
 * elles sont toujours multipliées, donc la durée ne change pas.
 *
 * La vidéo (4) est découpée en images, audio et images/s (16:3) ;
 * `FrameInterpolate` (16:2) ajoute `multiplier - 1` images entre chaque paire ;
 * `CreateVideo` (16:5) remonte la vidéo à `fps × multiplier` (16:11) avec
 * l'audio d'origine, s'il y en a.
 *
 * `meta` va dans le `_meta` du chargeur de modèle (16:1).
 */
export function buildFrameInterpolationPrompt(options: FrameInterpolationOptions, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const opts: ApiPrompt = {
        "4": {
            class_type: "LoadVideo",
            inputs: {
                file: options.video,
            },
            _meta: {}
        },
        "16:3": {
            class_type: "GetVideoComponents",
            inputs: {
                video: ["4", 0],
            },
            _meta: {}
        },
        "16:1": {
            class_type: "FrameInterpolationModelLoader",
            inputs: {
                model_name: options.modelName,
            },
            _meta: {}
        },
        "16:9": {
            class_type: "PrimitiveInt",
            inputs: {
                value: options.multiplier,
            },
            _meta: {}
        },
        "16:2": {
            class_type: "FrameInterpolate",
            inputs: {
                interp_model: ["16:1", 0],
                images: ["16:3", 0],
                multiplier: ["16:9", 0],
            },
            _meta: {}
        },
        "16:11": {
            class_type: "ComfyMathExpression",
            inputs: {
                expression: "a * b",
                "values.a": ["16:3", 2],
                "values.b": ["16:9", 0],
            },
            _meta: {}
        },
        "16:5": {
            class_type: "CreateVideo",
            inputs: {
                images: ["16:2", 0],
                audio: ["16:3", 1],
                fps: ["16:11", 0],
            },
            _meta: {}
        },
        "7": {
            class_type: "SaveVideo",
            inputs: {
                filename_prefix: "FrameInterpolation",
                format: "auto",
                "format.codec": "auto",
                codec: "auto",
                video: ["16:5", 0],
            },
            _meta: {}
        },
    };

    applyMeta(opts, "16:1", meta);

    return opts;
}

/**
 * Envoie la vidéo au serveur, puis le graphe d'interpolation. Ici,
 * `options.video` est un chemin local ; il est remplacé par le nom que
 * renvoie `uploadImage` (ComfyUI y accepte aussi les vidéos).
 */
export async function generateFrameInterpolation(options: FrameInterpolationOptions, settings: GenerateSettings = {}): Promise<string[]> {
    const video = await uploadImage(options.video, settings);
    settings.logger?.log(`[comfyui] vidéo envoyée`, video);
    return runGraph(buildFrameInterpolationPrompt({...options, video}, settings.meta ?? null), settings);
}
