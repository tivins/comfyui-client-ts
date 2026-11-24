import {type GenerateSettings} from "../client";
import {runGraphWithUploads} from "../upload";
import {applyMeta, Sampler, Scheduler, type ApiInput, type ApiNode, type ApiPrompt} from "../workflow";

/** Le modèle accepte au plus 10 images de référence. */
export const FLUX3_KLEIN_MAX_REFERENCES = 10;

export const FLUX3_KLEIN_DEFAULTS = {
  unetName: "flux3-image-klein-int8-convrot.safetensors",
  clipName: "qwen3vl_4b_int8_convrot.safetensors",
  vaeName: "flux2-vae.safetensors",
  width: 1024,
  height: 1024,
  samplerName: Sampler.Euler,
  scheduler: Scheduler.Simple,
  seed: 42,
  steps: 16,
  alpha: 16,
  referenceMegapixels: 1,
  batchSize: 1,
} as const satisfies {
  unetName: string;
  clipName: string;
  vaeName: string;
  width: number;
  height: number;
  samplerName: Sampler;
  scheduler: Scheduler;
  seed: number;
  steps: number;
  alpha: number;
  referenceMegapixels: number;
  batchSize: number;
};

export type Flux3KleinOptions = {
  prompt: string;
  /**
   * Images de référence, 0 à 10, dans l'ordre où le prompt les nomme (« the first image »,
   * « the second image »…). Vide : texte vers image. Pour `generateFlux3Klein`, des chemins
   * locaux ; pour `buildFlux3KleinPrompt`, les noms côté serveur que renvoie `uploadImage`.
   */
  referenceImages: string[];
  unetName: string;
  clipName: string;
  vaeName: string;
  /** Multiples de 16. */
  width: number;
  height: number;
  samplerName: Sampler;
  scheduler: Scheduler;
  seed: number;
  /** 16 pour le modèle distillé (4 à 16 possibles), 50 pour le modèle de base. */
  steps: number;
  /** Décalage des pas (`ModelSamplingFlux`, shift = ln(alpha)) : plus haut, plus de pas à fort bruit. */
  alpha: number;
  /** Taille de chaque référence avant encodage, en millions de pixels, proportions gardées. */
  referenceMegapixels: number;
  batchSize: number;
};

/**
 * Graphe API du sous-graphe « Multiple image to image (FLUX 3 Klein) » des workflows
 * `flux3_klein_int8_mi2i` / `flux3_klein_int8_t2i` du dépôt
 * `black-forest-labs/flux-3-image-klein-comfy`, sans le prompt upsampler ni les boîtes.
 *
 * cfg reste à 1 (modèle distillé, guidance fixe) : le négatif (105) est vide et ne compte pas.
 * Les références passent par `ReferenceMultiLatent` (136), entrées `images.image0`… ;
 * sans référence, le nœud est retiré et le KSampler prend les encodages directement.
 *
 * `meta` va dans le `_meta` de l'UNET (101).
 */
export function buildFlux3KleinPrompt(options: Flux3KleinOptions, meta: Record<string, ApiInput> | null = null): ApiPrompt {
  const refs = options.referenceImages;
  if (refs.length > FLUX3_KLEIN_MAX_REFERENCES) {
    throw new Error(`FLUX 3 Klein : ${refs.length} images de référence, ${FLUX3_KLEIN_MAX_REFERENCES} au plus`);
  }
  const shift = Math.log(options.alpha);
  const graph: ApiPrompt = {
    "101": {
      class_type: "UNETLoader",
      inputs: {unet_name: options.unetName, weight_dtype: "default"},
      _meta: {},
    },
    "102": {
      class_type: "CLIPLoader",
      inputs: {clip_name: options.clipName, type: "flux3", device: "default"},
      _meta: {},
    },
    "103": {
      class_type: "VAELoader",
      inputs: {vae_name: options.vaeName},
      _meta: {},
    },
    "104": {
      class_type: "CLIPTextEncode",
      inputs: {clip: ["102", 0], text: options.prompt},
      _meta: {},
    },
    "105": {
      class_type: "CLIPTextEncode",
      inputs: {clip: ["102", 0], text: ""},
      _meta: {},
    },
    "132": {
      class_type: "ModelSamplingFlux",
      inputs: {model: ["101", 0], max_shift: shift, base_shift: shift, width: 1024, height: 1024},
      _meta: {},
    },
    "139": {
      class_type: "EmptyFlux2LatentImage",
      inputs: {width: options.width, height: options.height, batch_size: options.batchSize},
      _meta: {},
    },
    "107": {
      class_type: "KSampler",
      inputs: {
        model: ["132", 0],
        positive: ["104", 0],
        negative: ["105", 0],
        latent_image: ["139", 0],
        seed: options.seed,
        steps: options.steps,
        cfg: 1,
        sampler_name: options.samplerName,
        scheduler: options.scheduler,
        denoise: 1,
      },
      _meta: {},
    },
    "108": {
      class_type: "VAEDecode",
      inputs: {samples: ["107", 0], vae: ["103", 0]},
      _meta: {},
    },
    "9": {
      class_type: "SaveImage",
      inputs: {images: ["108", 0], filename_prefix: "Flux3Klein"},
      _meta: {},
    },
  };

  if (refs.length > 0) {
    const multi: ApiNode = {
      class_type: "ReferenceMultiLatent",
      inputs: {
        positive: ["104", 0],
        negative: ["105", 0],
        vae: ["103", 0],
        resolution: "resize",
        "resolution.megapixels": options.referenceMegapixels,
      },
      _meta: {},
    };
    refs.forEach((image, i) => {
      const id = String(150 + i);
      graph[id] = {class_type: "LoadImage", inputs: {image}, _meta: {}};
      multi.inputs[`images.image${i}`] = [id, 0];
    });
    graph["136"] = multi;
    graph["107"].inputs.positive = ["136", 0];
    graph["107"].inputs.negative = ["136", 1];
  }

  applyMeta(graph, "101", meta);
  return graph;
}

/**
 * Envoie les images de référence (chemins locaux) avec `uploadImage`, puis le graphe
 * FLUX 3 Klein, et enregistre les images.
 */
export async function generateFlux3Klein(options: Flux3KleinOptions, settings: GenerateSettings = {}): Promise<string[]> {
  if (options.referenceImages.length > FLUX3_KLEIN_MAX_REFERENCES) {
    throw new Error(`FLUX 3 Klein : ${options.referenceImages.length} images de référence, ${FLUX3_KLEIN_MAX_REFERENCES} au plus`);
  }
  return runGraphWithUploads(options.referenceImages, settings,
    (referenceImages) => buildFlux3KleinPrompt({...options, referenceImages}, settings.meta ?? null));
}
