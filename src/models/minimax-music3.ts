import {runGraph, type GenerateSettings} from "../client";
import {applyMeta, type ApiInput, type ApiPrompt} from "../workflow";

export const MINIMAX_MUSIC3_DEFAULTS = {
  seed: 0,
  maxDuration: 60,
  steps: 30,
  cfg: 1.7,
  cfgScale: 1.7,
  topK: 50,
} as const satisfies Omit<MiniMaxMusic3Options, "caption" | "lyrics">;

export type MiniMaxMusic3Options = {
  /** Description structurée : `Global Metadata`, `Vocal Details`, `Arrangement`. */
  caption: string;
  /** Paroles avec balises de section (`[Verse]`, `[Chorus]`, `[Instrumental]`…). Vide pour un morceau instrumental. */
  lyrics: string;
  seed: number;
  /** Durée maximale en secondes (0.04 à 360). Le modèle peut finir le morceau plus tôt. */
  maxDuration: number;
  /** Pas du `KSampler`. */
  steps: number;
  /** cfg du `KSampler` (DiT). */
  cfg: number;
  /** `cfg_scale` de `MiniMaxMusic3TextEncode` (génération des jetons acoustiques). */
  cfgScale: number;
  /** `top_k` de `MiniMaxMusic3TextEncode`. */
  topK: number;
};

/**
 * Graphe API du workflow UI `audio_minimax_music_3`
 * (`docs/workflow_audio_minimax_music_3.json`).
 *
 * `MiniMaxMusic3TextEncode` (`37:13`) produit le conditionnement et la durée
 * réelle du morceau, qui dimensionne le latent vide. Le négatif est le
 * conditionnement mis à zéro. `KSampler` euler / simple, décodage VAE par
 * tuiles (l'interrupteur `37:43` est à `true`), enregistrement en mp3 V0.
 * La même graine sert à l'encodeur et au `KSampler`.
 *
 * `meta` va dans le `_meta` de l'UNET (`37:6`).
 */
export function buildMiniMaxMusic3Prompt(
    options: MiniMaxMusic3Options,
    meta: Record<string, ApiInput> | null = null,
): ApiPrompt {
    const opts: ApiPrompt = {
        "35": {
            inputs: {
                "filename_prefix": "audio/audio_minimax_music3",
                "format": "mp3",
                "format.quality": "V0",
                "audio": [
                    "37:43",
                    0
                ]
            },
            class_type: "SaveAudioAdvanced",
            _meta: {
                "title": "Enregistrer l’Audio (Avancé)"
            }
        },
        "37:6": {
            inputs: {
                "unet_name": "minimax_music3_dit_fp16.safetensors",
                "weight_dtype": "default"
            },
            class_type: "UNETLoader",
            _meta: {
                "title": "Charger Modèle Diffusion"
            }
        },
        "37:13": {
            inputs: {
                "caption": options.caption,
                "lyrics": options.lyrics,
                "seed": [
                    "37:38",
                    0
                ],
                "max_duration": options.maxDuration,
                "cfg_scale": options.cfgScale,
                "top_k": options.topK,
                "clip": [
                    "37:3",
                    0
                ]
            },
            class_type: "MiniMaxMusic3TextEncode",
            _meta: {
                "title": "Encodage de texte MiniMax Music3"
            }
        },
        "37:3": {
            inputs: {
                "clip_name": "minimax_music3_text_encoder_pruned_int8_convrot.safetensors",
                "type": "minimax",
                "device": "default"
            },
            class_type: "CLIPLoader",
            _meta: {
                "title": "Charger CLIP"
            }
        },
        "37:7": {
            inputs: {
                "vae_name": "minimax_music3_dav.safetensors"
            },
            class_type: "VAELoader",
            _meta: {
                "title": "Charger VAE"
            }
        },
        "37:10": {
            inputs: {
                "conditioning": [
                    "37:13",
                    0
                ]
            },
            class_type: "ConditioningZeroOut",
            _meta: {
                "title": "ConditioningZeroOut"
            }
        },
        "37:15": {
            inputs: {
                "seconds": [
                    "37:13",
                    1
                ],
                "batch_size": 1
            },
            class_type: "EmptyMiniMaxMusic3LatentAudio",
            _meta: {
                "title": "Audio latent MiniMax Music3 vide"
            }
        },
        "37:9": {
            inputs: {
                "seed": [
                    "37:38",
                    0
                ],
                "steps": options.steps,
                "cfg": options.cfg,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": [
                    "37:6",
                    0
                ],
                "positive": [
                    "37:13",
                    0
                ],
                "negative": [
                    "37:10",
                    0
                ],
                "latent_image": [
                    "37:15",
                    0
                ]
            },
            class_type: "KSampler",
            _meta: {
                "title": "KSampler"
            }
        },
        "37:12": {
            inputs: {
                "samples": [
                    "37:9",
                    0
                ],
                "vae": [
                    "37:7",
                    0
                ]
            },
            class_type: "VAEDecodeAudio",
            _meta: {
                "title": "VAEDecodeAudio"
            }
        },
        "37:38": {
            inputs: {
                "seed": options.seed
            },
            class_type: "SeedNode",
            _meta: {
                "title": "Graine"
            }
        },
        "37:42": {
            inputs: {
                "tile_size": 1536,
                "overlap": 64,
                "samples": [
                    "37:9",
                    0
                ],
                "vae": [
                    "37:7",
                    0
                ]
            },
            class_type: "VAEDecodeAudioTiled",
            _meta: {
                "title": "Décoder Audio VAE (par tuiles)"
            }
        },
        "37:43": {
            inputs: {
                "switch": true,
                "on_false": [
                    "37:12",
                    0
                ],
                "on_true": [
                    "37:42",
                    0
                ]
            },
            class_type: "ComfySwitchNode",
            _meta: {
                "title": "Commutateur"
            }
        }
    };

    applyMeta(opts, "37:6", meta);

    return opts;
}

/** Envoie le graphe MiniMax Music 3, attend la fin, et enregistre le mp3. */
export async function generateMiniMaxMusic3(
    options: MiniMaxMusic3Options,
    settings: GenerateSettings = {},
): Promise<string[]> {
    return runGraph(buildMiniMaxMusic3Prompt(options, settings.meta ?? null), settings);
}
