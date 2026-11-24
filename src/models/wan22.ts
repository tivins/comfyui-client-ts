import {type GenerateSettings} from "../client";
import {runGraphWithUploads} from "../upload";
import {applyMeta, type ApiInput, type ApiPrompt} from "../workflow";

/** Les réglages du workflow d'origine : 20 pas (10 high noise, 10 low noise), cfg 3.5, 5 s à 16 images/s. */
export const WAN22_DEFAULTS = {
    width: 640,
    height: 640,
    seed: 42,
    fps: 16,
    duration: 5,
    steps: 20,
    splitStep: 10,
    cfg: 3.5,
    lightning: false,
    negativePrompt: "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走",
} as const satisfies Omit<Wan22Options, "inputImage" | "prompt">;

export type Wan22Options = {
    /**
     * Pour `buildWan22Prompt`, nom de l'image dans le dossier `input` du serveur, tel que le renvoie
     * `uploadImage`. Pour `generateWan22`, chemin local : l'image est envoyée avant le graphe.
     * `WanImageToVideo` la met à `width` × `height` (bilinéaire, recadrée au centre).
     */
    inputImage: string;
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    seed: number;
    /** Images par seconde. */
    fps: number;
    /** Durée en secondes : `floor(duration × fps + 1)` images. */
    duration: number;
    /** Pas sans `lightning`, dont `splitStep` avec l'UNET high noise et le reste avec le low noise. */
    steps: number;
    splitStep: number;
    cfg: number;
    /**
     * LoRA lightx2v 4 pas sur les deux UNET : 4 pas (2 + 2), cfg 1. `steps`, `splitStep` et `cfg`
     * sont alors ignorés.
     */
    lightning: boolean;
};

/**
 * Graphe API du workflow UI Wan 2.2 image → vidéo (14B fp8).
 *
 * Deux `KSamplerAdvanced` se partagent les pas : l'UNET high noise
 * (`129:95`) jusqu'à `splitStep`, puis l'UNET low noise (`129:96`) jusqu'à
 * `steps`, euler / simple. L'interrupteur `129:131` choisit entre ces
 * valeurs et la LoRA lightx2v 4 pas (4 pas, coupure au pas 2, cfg 1), qui
 * reste dans le graphe quand elle est éteinte.
 *
 * `meta` s'ajoute au `_meta` de l'image d'entrée (97).
 */
export function buildWan22Prompt(options: Wan22Options, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const opts: ApiPrompt = {
        "97": {
            inputs: {
                image: options.inputImage
            },
            class_type: "LoadImage",
            _meta: {
                "title": "Charger Image"
            }
        },
        "108": {
            inputs: {
                "filename_prefix": "video_Wan2.2_i2v",
                "format": "auto",
                "format.codec": "auto",
                "codec": "auto",
                "video": [
                    "129:94",
                    0
                ]
            },
            class_type: "SaveVideo",
            _meta: {
                "title": "Enregistrer la vidéo"
            }
        },
        "129:98": {
            inputs: {
                "width": options.width,
                "height": options.height,
                "length": [
                    "129:163",
                    1
                ],
                "batch_size": 1,
                "positive": [
                    "129:93",
                    0
                ],
                "negative": [
                    "129:89",
                    0
                ],
                "vae": [
                    "129:90",
                    0
                ],
                "start_image": [
                    "97",
                    0
                ]
            },
            class_type: "WanImageToVideo",
            _meta: {
                "title": "WanImageVersVidéo"
            }
        },
        "129:94": {
            inputs: {
                "fps": [
                    "129:162",
                    0
                ],
                "bit_depth": 8,
                "color_space": "sRGB",
                "codec": "none",
                "images": [
                    "129:87",
                    0
                ]
            },
            class_type: "CreateVideo",
            _meta: {
                "title": "Créer une vidéo"
            }
        },
        "129:104": {
            inputs: {
                "shift": 5.000000000000001,
                "model": [
                    "129:116",
                    0
                ]
            },
            class_type: "ModelSamplingSD3",
            _meta: {
                "title": "ModèleÉchantillonnageSD3"
            }
        },
        "129:89": {
            inputs: {
                "text": options.negativePrompt,
                "clip": [
                    "129:84",
                    0
                ]
            },
            class_type: "CLIPTextEncode",
            _meta: {
                "title": "CLIP Text Encode (Negative Prompt)"
            }
        },
        "129:128": {
            inputs: {
                "value": options.steps
            },
            class_type: "PrimitiveInt",
            _meta: {
                "title": "Int (Steps)"
            }
        },
        "129:87": {
            inputs: {
                "samples": [
                    "129:85",
                    0
                ],
                "vae": [
                    "129:90",
                    0
                ]
            },
            class_type: "VAEDecode",
            _meta: {
                "title": "VAE Decode"
            }
        },
        "129:93": {
            inputs: {
                "text": options.prompt,
                "clip": [
                    "129:84",
                    0
                ]
            },
            class_type: "CLIPTextEncode",
            _meta: {
                "title": "CLIP Text Encode (Positive Prompt)"
            }
        },
        "129:131": {
            inputs: {
                "value": options.lightning
            },
            class_type: "PrimitiveBoolean",
            _meta: {
                "title": "Enable 4steps LoRA?"
            }
        },
        "129:90": {
            inputs: {
                "vae_name": "wan_2.1_vae.safetensors"
            },
            class_type: "VAELoader",
            _meta: {
                "title": "Charger VAE"
            }
        },
        "129:84": {
            inputs: {
                "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                "type": "wan",
                "device": "default"
            },
            class_type: "CLIPLoader",
            _meta: {
                "title": "Charger CLIP"
            }
        },
        "129:96": {
            inputs: {
                "unet_name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
                "weight_dtype": "default"
            },
            class_type: "UNETLoader",
            _meta: {
                "title": "Charger Modèle Diffusion"
            }
        },
        "129:95": {
            inputs: {
                "unet_name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
                "weight_dtype": "default"
            },
            class_type: "UNETLoader",
            _meta: {
                "title": "Charger Modèle Diffusion"
            }
        },
        "129:127": {
            inputs: {
                "value": options.splitStep
            },
            class_type: "PrimitiveInt",
            _meta: {
                "title": "Int (split_step)"
            }
        },
        "129:126": {
            inputs: {
                "value": options.cfg
            },
            class_type: "PrimitiveFloat",
            _meta: {
                "title": "Float (CFG)"
            }
        },
        "129:102": {
            inputs: {
                "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors",
                "strength_model": 1.0000000000000002,
                "model": [
                    "129:96",
                    0
                ]
            },
            class_type: "LoraLoaderModelOnly",
            _meta: {
                "title": "LoraLoaderModelOnly"
            }
        },
        "129:101": {
            inputs: {
                "lora_name": "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors",
                "strength_model": 1.0000000000000002,
                "model": [
                    "129:95",
                    0
                ]
            },
            class_type: "LoraLoaderModelOnly",
            _meta: {
                "title": "LoraLoaderModelOnly"
            }
        },
        "129:86": {
            inputs: {
                "add_noise": "enable",
                "noise_seed": options.seed,
                "steps": [
                    "129:119",
                    0
                ],
                "cfg": [
                    "129:120",
                    0
                ],
                "sampler_name": "euler",
                "scheduler": "simple",
                "start_at_step": 0,
                "end_at_step": [
                    "129:125",
                    0
                ],
                "return_with_leftover_noise": "enable",
                "model": [
                    "129:104",
                    0
                ],
                "positive": [
                    "129:98",
                    0
                ],
                "negative": [
                    "129:98",
                    1
                ],
                "latent_image": [
                    "129:98",
                    2
                ]
            },
            class_type: "KSamplerAdvanced",
            _meta: {
                "title": "KSampler (Avancé)"
            }
        },
        "129:85": {
            inputs: {
                "add_noise": "disable",
                "noise_seed": 0,
                "steps": [
                    "129:119",
                    0
                ],
                "cfg": [
                    "129:120",
                    0
                ],
                "sampler_name": "euler",
                "scheduler": "simple",
                "start_at_step": [
                    "129:125",
                    0
                ],
                "end_at_step": [
                    "129:119",
                    0
                ],
                "return_with_leftover_noise": "disable",
                "model": [
                    "129:103",
                    0
                ],
                "positive": [
                    "129:98",
                    0
                ],
                "negative": [
                    "129:98",
                    1
                ],
                "latent_image": [
                    "129:86",
                    0
                ]
            },
            class_type: "KSamplerAdvanced",
            _meta: {
                "title": "KSampler (Avancé)"
            }
        },
        "129:122": {
            inputs: {
                "value": 1
            },
            class_type: "PrimitiveFloat",
            _meta: {
                "title": "Float (CFG)"
            }
        },
        "129:124": {
            inputs: {
                "value": 2
            },
            class_type: "PrimitiveInt",
            _meta: {
                "title": "Int (split_step)"
            }
        },
        "129:118": {
            inputs: {
                "value": 4
            },
            class_type: "PrimitiveInt",
            _meta: {
                "title": "Int (Steps)"
            }
        },
        "129:116": {
            inputs: {
                "switch": [
                    "129:131",
                    0
                ],
                "on_false": [
                    "129:95",
                    0
                ],
                "on_true": [
                    "129:101",
                    0
                ]
            },
            class_type: "ComfySwitchNode",
            _meta: {
                "title": "Switch (Model)"
            }
        },
        "129:125": {
            inputs: {
                "switch": [
                    "129:131",
                    0
                ],
                "on_false": [
                    "129:127",
                    0
                ],
                "on_true": [
                    "129:124",
                    0
                ]
            },
            class_type: "ComfySwitchNode",
            _meta: {
                "title": "Switch (Split Step)"
            }
        },
        "129:119": {
            inputs: {
                "switch": [
                    "129:131",
                    0
                ],
                "on_false": [
                    "129:128",
                    0
                ],
                "on_true": [
                    "129:118",
                    0
                ]
            },
            class_type: "ComfySwitchNode",
            _meta: {
                "title": "Switch (Steps)"
            }
        },
        "129:120": {
            inputs: {
                "switch": [
                    "129:131",
                    0
                ],
                "on_false": [
                    "129:126",
                    0
                ],
                "on_true": [
                    "129:122",
                    0
                ]
            },
            class_type: "ComfySwitchNode",
            _meta: {
                "title": "Switch (CFG)"
            }
        },
        "129:103": {
            inputs: {
                "shift": 5.000000000000001,
                "model": [
                    "129:117",
                    0
                ]
            },
            class_type: "ModelSamplingSD3",
            _meta: {
                "title": "ModèleÉchantillonnageSD3"
            }
        },
        "129:117": {
            inputs: {
                "switch": [
                    "129:131",
                    0
                ],
                "on_false": [
                    "129:96",
                    0
                ],
                "on_true": [
                    "129:102",
                    0
                ]
            },
            class_type: "ComfySwitchNode",
            _meta: {
                "title": "Switch (Model)"
            }
        },
        "129:161": {
            inputs: {
                "value": options.duration
            },
            class_type: "PrimitiveFloat",
            _meta: {
                "title": "Float (Duration)"
            }
        },
        "129:162": {
            inputs: {
                "value": options.fps
            },
            class_type: "PrimitiveFloat",
            _meta: {
                "title": "Float (FPS)"
            }
        },
        "129:163": {
            inputs: {
                "expression": "floor (a * b + 1)",
                "values.a": [
                    "129:161",
                    0
                ],
                "values.b": [
                    "129:162",
                    0
                ]
            },
            class_type: "ComfyMathExpression",
            _meta: {
                "title": "Expression mathématique"
            }
        }
    };

    applyMeta(opts, "97", meta);

    return opts;
}

/**
 * Envoie l'image de départ au serveur, puis le graphe Wan 2.2, attend la fin, et enregistre la vidéo.
 * Ici, `options.inputImage` est un chemin local ; il est remplacé par le nom que renvoie `uploadImage`.
 */
export async function generateWan22(options: Wan22Options, settings: GenerateSettings = {}): Promise<string[]> {
    return runGraphWithUploads([options.inputImage], settings,
        ([inputImage]) => buildWan22Prompt({...options, inputImage: inputImage!}, settings.meta ?? null));
}
