/** Lien vers la sortie `slot` d'un nœud du graphe API. */
export type NodeRef = [string, number];

export type ApiInput = string | number | boolean | NodeRef;

export type ApiNode = {
  class_type: string;
  inputs: Record<string, ApiInput>;
  _meta: Record<string, ApiInput>;
};

export type ApiPrompt = Record<string, ApiNode>;

function values<const T extends Record<string, string>>(record: T): T[keyof T][] {
  return Object.values(record) as T[keyof T][];
}

/** Ratios du nœud `ResolutionSelector`. La valeur est la chaîne envoyée à ComfyUI. */
export const Aspect = {
  Square: "1:1 (Square)",
  PortraitPhoto: "2:3 (Portrait Photo)",
  Photo: "3:2 (Photo)",
  PortraitStandard: "3:4 (Portrait Standard)",
  Standard: "4:3 (Standard)",
  PortraitWidescreen: "9:16 (Portrait Widescreen)",
  Widescreen: "16:9 (Widescreen)",
  Ultrawide: "21:9 (Ultrawide)",
} as const;

export type Aspect = (typeof Aspect)[keyof typeof Aspect];

export const ASPECT_RATIOS: Aspect[] = values(Aspect);

/** Noms de sampler du `KSampler`. La valeur est la chaîne envoyée à ComfyUI. */
export const Sampler = {
  Euler: "euler",
  EulerCfgPp: "euler_cfg_pp",
  EulerAncestral: "euler_ancestral",
  EulerAncestralCfgPp: "euler_ancestral_cfg_pp",
  Heun: "heun",
  Heunpp2: "heunpp2",
  ExpHeun2X0: "exp_heun_2_x0",
  ExpHeun2X0Sde: "exp_heun_2_x0_sde",
  Dpm2: "dpm_2",
  Dpm2Ancestral: "dpm_2_ancestral",
  Lms: "lms",
  DpmFast: "dpm_fast",
  DpmAdaptive: "dpm_adaptive",
  Dpmpp2sAncestral: "dpmpp_2s_ancestral",
  Dpmpp2sAncestralCfgPp: "dpmpp_2s_ancestral_cfg_pp",
  DpmppSde: "dpmpp_sde",
  DpmppSdeGpu: "dpmpp_sde_gpu",
  Dpmpp2m: "dpmpp_2m",
  Dpmpp2mCfgPp: "dpmpp_2m_cfg_pp",
  Dpmpp2mSde: "dpmpp_2m_sde",
  Dpmpp2mSdeGpu: "dpmpp_2m_sde_gpu",
  Dpmpp2mSdeHeun: "dpmpp_2m_sde_heun",
  Dpmpp2mSdeHeunGpu: "dpmpp_2m_sde_heun_gpu",
  Dpmpp3mSde: "dpmpp_3m_sde",
  Dpmpp3mSdeGpu: "dpmpp_3m_sde_gpu",
  Ddpm: "ddpm",
  Lcm: "lcm",
  Ipndm: "ipndm",
  IpndmV: "ipndm_v",
  Deis: "deis",
  CfgppUd10Ab: "cfgpp_ud10_ab",
  ResMultistep: "res_multistep",
  ResMultistepCfgPp: "res_multistep_cfg_pp",
  ResMultistepAncestral: "res_multistep_ancestral",
  ResMultistepAncestralCfgPp: "res_multistep_ancestral_cfg_pp",
  GradientEstimation: "gradient_estimation",
  GradientEstimationCfgPp: "gradient_estimation_cfg_pp",
  ErSde: "er_sde",
  Seeds2: "seeds_2",
  Seeds3: "seeds_3",
  SaSolver: "sa_solver",
  SaSolverPece: "sa_solver_pece",
  Ddim: "ddim",
  UniPc: "uni_pc",
  UniPcBh2: "uni_pc_bh2",
} as const;

export type Sampler = (typeof Sampler)[keyof typeof Sampler];

export const SAMPLER_NAMES: Sampler[] = values(Sampler);

/** Schedulers du `KSampler`. La valeur est la chaîne envoyée à ComfyUI. */
export const Scheduler = {
  Simple: "simple",
  SgmUniform: "sgm_uniform",
  Karras: "karras",
  Exponential: "exponential",
  DdimUniform: "ddim_uniform",
  Beta: "beta",
  Normal: "normal",
  LinearQuadratic: "linear_quadratic",
  KlOptimal: "kl_optimal",
} as const;

export type Scheduler = (typeof Scheduler)[keyof typeof Scheduler];

export const SCHEDULER_NAMES: Scheduler[] = values(Scheduler);

export const QWEN_IMAGE_DEFAULTS = {
  unetName: "qwen_image_2.1_int8_convrot.safetensors",
  aspectRatio: Aspect.Standard,
  samplerName: Sampler.Euler,
  seed: 0,
  steps: 25,
  scheduler: Scheduler.Simple,
} as const satisfies {
  unetName: string;
  aspectRatio: Aspect;
  samplerName: Sampler;
  seed: number;
  steps: number;
  scheduler: Scheduler;
};

export type QwenImageOptions = {
  prompt: string;
  negativePrompt: string;
  unetName: string;
  aspectRatio: Aspect;
  samplerName: Sampler;
  seed: number;
  steps: number;
  scheduler: Scheduler;
};

/**
 * Graphe API du workflow UI `image_qwen_image_2_1_t2i_001_simple`.
 *
 * Le fichier UI garde deux copies des widgets :
 * - `widgets_values` : tableau positionnel, lu par les anciens frontends
 * - `widgets_values_named` : mêmes valeurs par nom, lu par le frontend actuel
 *
 * `POST /prompt` n'utilise ni l'un ni l'autre. Les textes partent dans
 * `inputs.prompt` et `inputs.negative_prompt` du nœud 484
 * (`TextEncodeQwenImage21`).
 *
 * Le sous-graphe 496 (prompt enhancer) et la note 463 ne sont pas exécutés :
 * leurs nœuds internes sont en bypass et la sortie n'est reliée à rien.
 */
export function buildQwenImagePrompt(options: QwenImageOptions): ApiPrompt {
    return {
        "13": {
            class_type: "ResolutionSelector",
            inputs: {
                aspect_ratio: options.aspectRatio,
                megapixels: 1,
                multiple: 8,
            },
            _meta: {}
        },
        "483": {
            class_type: "UNETLoader",
            inputs: {
                unet_name: options.unetName,
                weight_dtype: "default",
            },
            _meta: {}
        },
        "485": {
            class_type: "CLIPLoader",
            inputs: {
                clip_name: "qwen3vl_8b_int8_convrot.safetensors",
                type: "qwen_image",
                device: "default",
            },
            _meta: {}
        },
        "486": {
            class_type: "VAELoader",
            inputs: {
                vae_name: "qwen_image_2.1_vae_bf16.safetensors",
            },
            _meta: {}
        },
        "484": {
            class_type: "TextEncodeQwenImage21",
            inputs: {
                clip: ["485", 0],
                prompt: options.prompt,
                negative_prompt: options.negativePrompt,
                resolution: 1024,
            },
            _meta: {}
        },
        "487": {
            class_type: "EmptyLatentImage",
            inputs: {
                width: ["13", 0],
                height: ["13", 1],
                batch_size: 1,
            },
            _meta: {}
        },
        "495": {
            class_type: "QwenImage21Cache",
            inputs: {
                model: ["483", 0],
                device: "auto",
                dtype: "default",
            },
            _meta: {}
        },
        "489": {
            class_type: "KSampler",
            inputs: {
                model: ["495", 0],
                positive: ["484", 0],
                negative: ["484", 1],
                latent_image: ["487", 0],
                seed: options.seed,
                steps: options.steps,
                cfg: 1,
                sampler_name: options.samplerName,
                scheduler: options.scheduler,
                denoise: 1,
            },
            _meta: {}
        },
        "488": {
            class_type: "VAEDecode",
            inputs: {
                samples: ["489", 0],
                vae: ["486", 0],
            },
            _meta: {}
        },
        "461": {
            class_type: "SaveImageAdvanced",
            inputs: {
                images: ["488", 0],
                filename_prefix: "Qwen_image_2.1",
                format: "png",
                "format.bit_depth": "8-bit",
                "format.input_color_space": "sRGB",
            },
            _meta: {}
        },
    };
}

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
export type LoRA = {
    model: string;
    weight: number;
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
 */
export function buildKrea2Prompt(options: Krea2Options, meta:  Record<string, ApiInput>|null = null): ApiPrompt {
    let opts: ApiPrompt = {
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

    if (meta !== null) {
        opts["1"]._meta = meta;
    }

    let lastModelIndex = 1;
    let kSamplerIndex = "2";
    let startAs = 12;
    for (const lora of options.loras) {
        opts[startAs.toString()] = {
            inputs: {
                lora_name: lora.model,
                strength_model: lora.weight,
                model: [lastModelIndex.toString(), 0]
            },
            class_type: "LoraLoaderModelOnly",
            _meta:{}
        };
        // @ts-ignore
        opts[kSamplerIndex].inputs.model[0] = startAs.toString();
        lastModelIndex = startAs;
        startAs++;
    }

    return opts;
}


export type Wan22Options = {
    inputImage: string;
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
    fps: number;
};
export function buildWan22Prompt(options: Wan22Options): ApiPrompt {
    let opts: ApiPrompt = {
        "97": {
            inputs: {
                image: options.inputImage
            },
            class_type: "LoadImage",
            _meta: {
                "title": "Charger Image",
                "something": "else"
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
                "text": "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走",
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
                "value": 20
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
                "value": false
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
                "value": 10
            },
            class_type: "PrimitiveInt",
            _meta: {
                "title": "Int (split_step)"
            }
        },
        "129:126": {
            inputs: {
                "value": 3.5
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
                "value": 5
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
    return opts;
}