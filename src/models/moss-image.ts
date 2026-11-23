import {runGraph, type GenerateSettings} from "../client";
import {applyMeta, Sampler, Scheduler, type ApiInput, type ApiPrompt} from "../workflow";

/** Nature d'une boîte : un objet, un personnage, ou un texte rendu tel quel. */
export const MossBoxKind = {
  Object: "object",
  Character: "character",
  Text: "text",
} as const;
export type MossBoxKind = (typeof MossBoxKind)[keyof typeof MossBoxKind];

/**
 * Une boîte de la mise en page, en pixels de l'image (origine en haut à gauche).
 * `description` décrit ce qui va dans la boîte ; pour un texte, `text` est la
 * chaîne à écrire (retours à la ligne compris) et `description` son style.
 */
export type MossBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: MossBoxKind;
  description: string;
  text?: string;
};

/** Skip Layer Guidance (`SkipLayerGuidanceDiTSimple`) : couches sautées et plage de pas. */
export type MossSkipLayerGuidance = {
  layers: readonly number[];
  start: number;
  end: number;
};

export const MOSS_IMAGE_DEFAULTS = {
  unetName: "moss_image_sft_bf16.safetensors",
  clipName: "qwen3.5_9b_int8_convrot.safetensors",
  vaeName: "flux2-vae.safetensors",
  width: 1024,
  height: 1024,
  boxes: [],
  seed: 42,
  steps: 25,
  cfg: 2.5,
  samplerName: Sampler.ErSde,
  scheduler: Scheduler.Simple,
  skipLayerGuidance: {layers: [22], start: 0, end: 0.5},
} as const satisfies Omit<MossImageOptions, "prompt" | "negativePrompt">;

export type MossImageOptions = {
  /** Description de toute l'image. Avec des boîtes, elle devient la légende globale de la mise en page. */
  prompt: string;
  negativePrompt: string;
  unetName: string;
  clipName: string;
  vaeName: string;
  /** Multiple de 16. Le modèle vise 1 à 2 Mpx. */
  width: number;
  /** Multiple de 16. */
  height: number;
  /** Mise en page ; vide, le prompt va tel quel à l'encodeur. */
  boxes: readonly MossBox[];
  seed: number;
  steps: number;
  cfg: number;
  samplerName: Sampler;
  scheduler: Scheduler;
  /** `null` retire le nœud : le modèle va droit au `KSampler`. */
  skipLayerGuidance: MossSkipLayerGuidance | null;
};

/** Préfixe des fichiers enregistrés. */
export const MOSS_IMAGE_PREFIX = "MossImage";

function checkOptions(options: MossImageOptions): void {
  for (const [name, value] of [["width", options.width], ["height", options.height]] as const) {
    if (!Number.isInteger(value) || value <= 0 || value % 16 !== 0) {
      throw new Error(`MOSS-Image : ${name} doit être un multiple de 16 (reçu ${value})`);
    }
  }
  options.boxes.forEach((box, i) => {
    if (box.kind === MossBoxKind.Text && !box.text) {
      throw new Error(`MOSS-Image : la boîte ${i + 1} est un texte sans \`text\``);
    }
  });
}

/**
 * Graphe API repris des modèles de workflow `image_moss_image_t2i` et
 * `image_moss_image_t2i_bboxes` de ComfyUI, sans le prompt upsampler (il réécrit
 * le prompt et perd la mise en page).
 *
 * Sans boîte, le prompt va droit au `CLIPTextEncode` (4). Avec des boîtes,
 * `CreateBoundingBoxes` (20) reçoit la liste emballée dans `__value__`, et
 * `MOSSImageLayoutPrompt` (21) en tire un prompt JSON (légende, puis un élément
 * par boîte) qui remplace le texte du nœud 4. Les boîtes `character` sont
 * passées à `character_boxes` par leur numéro, à partir de 1, dans l'ordre de
 * la liste. Le CLIP est chargé en type `moss_image`. Demande ComfyUI ≥ 0.46.
 *
 * `meta` va dans le `_meta` de l'UNET (1).
 */
export function buildMossImagePrompt(options: MossImageOptions, meta: Record<string, ApiInput> | null = null): ApiPrompt {
  checkOptions(options);
  const slg = options.skipLayerGuidance;
  const graph: ApiPrompt = {
    "1": {
      class_type: "UNETLoader",
      inputs: {unet_name: options.unetName, weight_dtype: "default"},
      _meta: {},
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: {clip_name: options.clipName, type: "moss_image", device: "default"},
      _meta: {},
    },
    "3": {
      class_type: "VAELoader",
      inputs: {vae_name: options.vaeName},
      _meta: {},
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {clip: ["2", 0], text: options.prompt},
      _meta: {},
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: {clip: ["2", 0], text: options.negativePrompt},
      _meta: {},
    },
    "6": {
      class_type: "EmptyFlux2LatentImage",
      inputs: {width: options.width, height: options.height, batch_size: 1},
      _meta: {},
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: slg ? ["15", 0] : ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed: options.seed,
        steps: options.steps,
        cfg: options.cfg,
        sampler_name: options.samplerName,
        scheduler: options.scheduler,
        denoise: 1,
      },
      _meta: {},
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {samples: ["7", 0], vae: ["3", 0]},
      _meta: {},
    },
    "9": {
      class_type: "SaveImage",
      inputs: {images: ["8", 0], filename_prefix: MOSS_IMAGE_PREFIX},
      _meta: {},
    },
  };

  if (slg) {
    graph["15"] = {
      class_type: "SkipLayerGuidanceDiTSimple",
      inputs: {
        model: ["1", 0],
        double_layers: "",
        single_layers: slg.layers.join(", "),
        start_percent: slg.start,
        end_percent: slg.end,
      },
      _meta: {},
    };
  }

  if (options.boxes.length > 0) {
    graph["20"] = {
      class_type: "CreateBoundingBoxes",
      inputs: {
        width: options.width,
        height: options.height,
        editor_state: {
          __value__: options.boxes.map((box) => ({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            metadata: {
              type: box.kind === MossBoxKind.Text ? "text" : "obj",
              text: box.text ?? "",
              desc: box.description,
              palette: [],
            },
          })),
        },
      },
      _meta: {},
    };
    graph["21"] = {
      class_type: "MOSSImageLayoutPrompt",
      inputs: {
        prompt: options.prompt,
        element: ["20", 2],
        width: options.width,
        height: options.height,
        character_boxes: options.boxes
          .flatMap((box, i) => (box.kind === MossBoxKind.Character ? [String(i + 1)] : []))
          .join(", "),
      },
      _meta: {},
    };
    graph["4"]!.inputs.text = ["21", 0];
  }

  applyMeta(graph, "1", meta);
  return graph;
}

/** Envoie le graphe MOSS-Image, attend la fin, et enregistre l'image. */
export async function generateMossImage(options: MossImageOptions, settings: GenerateSettings = {}): Promise<string[]> {
  return runGraph(buildMossImagePrompt(options, settings.meta ?? null), settings);
}
