/** Lien vers la sortie `slot` d'un nœud du graphe API. */
export type NodeRef = [string, number];

export type ApiInput = string | number | NodeRef;

export type ApiNode = {
  class_type: string;
  inputs: Record<string, ApiInput>;
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
    },
    "483": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: options.unetName,
        weight_dtype: "default",
      },
    },
    "485": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_8b_int8_convrot.safetensors",
        type: "qwen_image",
        device: "default",
      },
    },
    "486": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "qwen_image_2.1_vae_bf16.safetensors",
      },
    },
    "484": {
      class_type: "TextEncodeQwenImage21",
      inputs: {
        clip: ["485", 0],
        prompt: options.prompt,
        negative_prompt: options.negativePrompt,
        resolution: 1024,
      },
    },
    "487": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: ["13", 0],
        height: ["13", 1],
        batch_size: 1,
      },
    },
    "495": {
      class_type: "QwenImage21Cache",
      inputs: {
        model: ["483", 0],
        device: "auto",
        dtype: "default",
      },
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
    },
    "488": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["489", 0],
        vae: ["486", 0],
      },
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
} as const satisfies {
  unetName: string;
  width: number;
  height: number;
  samplerName: Sampler;
  seed: number;
  steps: number;
  cfg: number;
  scheduler: Scheduler;
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
};

/**
 * Graphe API du workflow UI `krea2_safetensor`.
 *
 * Deux `CLIPTextEncode` : le nœud 8 porte le prompt, le nœud 9 le négatif.
 * Le CLIP est chargé en type `krea2`. Largeur et hauteur sont fixes
 * (pas de `ResolutionSelector`). `cfg` vaut 1.5 dans l'exemple qui tourne.
 */
export function buildKrea2Prompt(options: Krea2Options): ApiPrompt {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: options.unetName,
        weight_dtype: "default",
      },
    },
    "7": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
        type: "krea2",
        device: "default",
      },
    },
    "5": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "qwen_image_vae.safetensors",
      },
    },
    "8": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["7", 0],
        text: options.prompt,
      },
    },
    "9": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["7", 0],
        text: options.negativePrompt,
      },
    },
    "11": {
      class_type: "EmptyLatentImage",
      inputs: {
        width: options.width,
        height: options.height,
        batch_size: 1,
      },
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
    },
    "3": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["2", 0],
        vae: ["5", 0],
      },
    },
    "4": {
      class_type: "SaveImage",
      inputs: {
        images: ["3", 0],
        filename_prefix: "Krea2",
      },
    },
  };
}
