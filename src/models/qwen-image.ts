import {runGraph, type GenerateSettings} from "../client";
import {applyMeta, Aspect, Sampler, Scheduler, type ApiInput, type ApiPrompt} from "../workflow";

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
 *
 * `meta` va dans le `_meta` de l'UNET (483).
 */
export function buildQwenImagePrompt(options: QwenImageOptions, meta: Record<string, ApiInput> | null = null): ApiPrompt {
    const graph: ApiPrompt = {
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

    applyMeta(graph, "483", meta);

    return graph;
}

/** Envoie le graphe Qwen, attend la fin, et enregistre les images. */
export async function generateQwenImage(options: QwenImageOptions, settings: GenerateSettings = {}): Promise<string[]> {
    return runGraph(buildQwenImagePrompt(options, settings.meta ?? null), settings);
}
