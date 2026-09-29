/** Lien vers la sortie `slot` d'un nœud du graphe API. */
export type NodeRef = [string, number];

export type ApiInput = string | number | NodeRef;

export type ApiNode = {
  class_type: string;
  inputs: Record<string, ApiInput>;
};

export type ApiPrompt = Record<string, ApiNode>;

export const ASPECT_RATIOS = [
  "1:1 (Square)",
  "2:3 (Portrait Photo)",
  "3:2 (Photo)",
  "3:4 (Portrait Standard)",
  "4:3 (Standard)",
  "9:16 (Portrait Widescreen)",
  "16:9 (Widescreen)",
  "21:9 (Ultrawide)",
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const SAMPLER_NAMES = [
  "euler",
  "euler_cfg_pp",
  "euler_ancestral",
  "euler_ancestral_cfg_pp",
  "heun",
  "heunpp2",
  "exp_heun_2_x0",
  "exp_heun_2_x0_sde",
  "dpm_2",
  "dpm_2_ancestral",
  "lms",
  "dpm_fast",
  "dpm_adaptive",
  "dpmpp_2s_ancestral",
  "dpmpp_2s_ancestral_cfg_pp",
  "dpmpp_sde",
  "dpmpp_sde_gpu",
  "dpmpp_2m",
  "dpmpp_2m_cfg_pp",
  "dpmpp_2m_sde",
  "dpmpp_2m_sde_gpu",
  "dpmpp_2m_sde_heun",
  "dpmpp_2m_sde_heun_gpu",
  "dpmpp_3m_sde",
  "dpmpp_3m_sde_gpu",
  "ddpm",
  "lcm",
  "ipndm",
  "ipndm_v",
  "deis",
  "cfgpp_ud10_ab",
  "res_multistep",
  "res_multistep_cfg_pp",
  "res_multistep_ancestral",
  "res_multistep_ancestral_cfg_pp",
  "gradient_estimation",
  "gradient_estimation_cfg_pp",
  "er_sde",
  "seeds_2",
  "seeds_3",
  "sa_solver",
  "sa_solver_pece",
  "ddim",
  "uni_pc",
  "uni_pc_bh2",
] as const;

export type SamplerName = (typeof SAMPLER_NAMES)[number];

export const SCHEDULER_NAMES = [
  "simple",
  "sgm_uniform",
  "karras",
  "exponential",
  "ddim_uniform",
  "beta",
  "normal",
  "linear_quadratic",
  "kl_optimal",
] as const;

export type SchedulerName = (typeof SCHEDULER_NAMES)[number];

export const QWEN_IMAGE_DEFAULTS = {
  unetName: "qwen_image_2.1_int8_convrot.safetensors",
  aspectRatio: "4:3 (Standard)",
  samplerName: "euler",
  seed: 0,
  steps: 25,
  scheduler: "simple",
} as const satisfies {
  unetName: string;
  aspectRatio: AspectRatio;
  samplerName: SamplerName;
  seed: number;
  steps: number;
  scheduler: SchedulerName;
};

export type QwenImageOptions = {
  prompt: string;
  negativePrompt: string;
  unetName: string;
  aspectRatio: AspectRatio;
  samplerName: SamplerName;
  seed: number;
  steps: number;
  scheduler: SchedulerName;
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
