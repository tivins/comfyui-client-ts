import { describe, expect, test } from "bun:test";

import { parseGenerateArgs } from "./generate.ts";
import {
  Aspect,
  KREA2_DEFAULTS,
  QWEN_IMAGE_DEFAULTS,
  Sampler,
  Scheduler,
  buildKrea2Prompt,
  buildQwenImagePrompt,
  type Krea2Options,
  type QwenImageOptions,
} from "./workflow.ts";

const baseOptions: QwenImageOptions = {
  prompt: "a red kettle",
  negativePrompt: "blur",
  unetName: QWEN_IMAGE_DEFAULTS.unetName,
  aspectRatio: QWEN_IMAGE_DEFAULTS.aspectRatio,
  samplerName: QWEN_IMAGE_DEFAULTS.samplerName,
  seed: QWEN_IMAGE_DEFAULTS.seed,
  steps: QWEN_IMAGE_DEFAULTS.steps,
  scheduler: QWEN_IMAGE_DEFAULTS.scheduler,
};

describe("Sampler", () => {
  test("expose la chaîne attendue par ComfyUI", () => {
    expect(Aspect.Standard).toBe("4:3 (Standard)");
    expect(Sampler.Euler).toBe("euler");
    expect(Scheduler.Simple).toBe("simple");
    expect(Sampler.Dpmpp2m).toBe("dpmpp_2m");
    expect(Scheduler.Karras).toBe("karras");
  });
});

describe("buildQwenImagePrompt", () => {
  test("place le prompt et le négatif sur le nœud 484", () => {
    const graph = buildQwenImagePrompt(baseOptions);

    expect(graph["484"]?.class_type).toBe("TextEncodeQwenImage21");
    expect(graph["484"]?.inputs.prompt).toBe("a red kettle");
    expect(graph["484"]?.inputs.negative_prompt).toBe("blur");
    expect(graph["484"]?.inputs.clip).toEqual(["485", 0]);
  });

  test("pose le modèle, le ratio et le sampler", () => {
    const graph = buildQwenImagePrompt({
      ...baseOptions,
      unetName: "other.safetensors",
      aspectRatio: "16:9 (Widescreen)",
      samplerName: "dpmpp_2m",
      seed: 42,
      steps: 40,
      scheduler: "beta",
    });

    expect(graph["483"]?.inputs.unet_name).toBe("other.safetensors");
    expect(graph["13"]?.inputs.aspect_ratio).toBe("16:9 (Widescreen)");
    expect(graph["13"]?.inputs.megapixels).toBe(1);
    expect(graph["489"]?.inputs.sampler_name).toBe("dpmpp_2m");
    expect(graph["489"]?.inputs.seed).toBe(42);
    expect(graph["489"]?.inputs.steps).toBe(40);
    expect(graph["489"]?.inputs.scheduler).toBe("beta");
    expect(graph["489"]?.inputs.cfg).toBe(1);
  });

  test("ne reprend pas control_after_generate, réservé à l'éditeur", () => {
    const graph = buildQwenImagePrompt({
      ...baseOptions,
      prompt: "cat",
      negativePrompt: "",
    });

    expect(graph["489"]?.inputs).not.toHaveProperty("control_after_generate");
    expect(graph["489"]?.inputs.seed).toBe(0);
    expect(graph["489"]?.inputs.cfg).toBe(1);
    expect(graph["461"]?.inputs["format.bit_depth"]).toBe("8-bit");
  });
});

const kreaOptions: Krea2Options = {
  prompt: "a red kettle",
  negativePrompt: "blur",
  unetName: KREA2_DEFAULTS.unetName,
  width: KREA2_DEFAULTS.width,
  height: KREA2_DEFAULTS.height,
  samplerName: KREA2_DEFAULTS.samplerName,
  seed: KREA2_DEFAULTS.seed,
  steps: KREA2_DEFAULTS.steps,
  cfg: KREA2_DEFAULTS.cfg,
  scheduler: KREA2_DEFAULTS.scheduler,
};

describe("buildKrea2Prompt", () => {
  test("place le prompt et le négatif sur deux CLIPTextEncode", () => {
    const graph = buildKrea2Prompt(kreaOptions);

    expect(graph["8"]?.class_type).toBe("CLIPTextEncode");
    expect(graph["8"]?.inputs.text).toBe("a red kettle");
    expect(graph["8"]?.inputs.clip).toEqual(["7", 0]);
    expect(graph["9"]?.inputs.text).toBe("blur");
    expect(graph["9"]?.inputs.clip).toEqual(["7", 0]);
    expect(graph["7"]?.inputs.type).toBe("krea2");
    expect(graph["7"]?.inputs.clip_name).toBe("qwen3vl_4b_fp8_scaled.safetensors");
  });

  test("reprend le modèle, la taille et le sampler de l'exemple", () => {
    const graph = buildKrea2Prompt({
      ...kreaOptions,
      unetName: "other.safetensors",
      width: 768,
      height: 1024,
      samplerName: "dpmpp_2m",
      seed: 7,
      steps: 20,
      cfg: 2,
      scheduler: "beta",
    });

    expect(graph["1"]?.inputs.unet_name).toBe("other.safetensors");
    expect(graph["1"]?.inputs.weight_dtype).toBe("default");
    expect(graph["5"]?.inputs.vae_name).toBe("qwen_image_vae.safetensors");
    expect(graph["11"]?.inputs.width).toBe(768);
    expect(graph["11"]?.inputs.height).toBe(1024);
    expect(graph["11"]?.inputs.batch_size).toBe(1);
    expect(graph["2"]?.inputs.model).toEqual(["1", 0]);
    expect(graph["2"]?.inputs.positive).toEqual(["8", 0]);
    expect(graph["2"]?.inputs.negative).toEqual(["9", 0]);
    expect(graph["2"]?.inputs.latent_image).toEqual(["11", 0]);
    expect(graph["2"]?.inputs.sampler_name).toBe("dpmpp_2m");
    expect(graph["2"]?.inputs.seed).toBe(7);
    expect(graph["2"]?.inputs.steps).toBe(20);
    expect(graph["2"]?.inputs.cfg).toBe(2);
    expect(graph["2"]?.inputs.scheduler).toBe("beta");
    expect(graph["2"]?.inputs.denoise).toBe(1);
    expect(graph["3"]?.inputs.samples).toEqual(["2", 0]);
    expect(graph["3"]?.inputs.vae).toEqual(["5", 0]);
    expect(graph["4"]?.inputs.images).toEqual(["3", 0]);
    expect(graph["4"]?.inputs.filename_prefix).toBe("Krea2");
  });

  test("garde les défauts du workflow krea2_safetensor", () => {
    const graph = buildKrea2Prompt(kreaOptions);

    expect(graph["1"]?.inputs.unet_name).toBe("museByStableYogi_v35Int8Extended.safetensors");
    expect(graph["11"]?.inputs.width).toBe(960);
    expect(graph["11"]?.inputs.height).toBe(1472);
    expect(graph["2"]?.inputs.seed).toBe(42);
    expect(graph["2"]?.inputs.steps).toBe(16);
    expect(graph["2"]?.inputs.cfg).toBe(1.5);
    expect(graph["2"]?.inputs.sampler_name).toBe("euler");
    expect(graph["2"]?.inputs.scheduler).toBe("simple");
    expect(graph["2"]?.inputs).not.toHaveProperty("control_after_generate");
  });
});

describe("parseGenerateArgs", () => {
  test("reprend les défauts du workflow", () => {
    const { options } = parseGenerateArgs([]);
    expect(options.unetName).toBe(QWEN_IMAGE_DEFAULTS.unetName);
    expect(options.aspectRatio).toBe("4:3 (Standard)");
    expect(options.samplerName).toBe("euler");
    expect(options.seed).toBe(0);
    expect(options.steps).toBe(25);
    expect(options.scheduler).toBe("simple");
  });

  test("lit les options d'image", () => {
    const { options } = parseGenerateArgs([
      "--unet",
      "other.safetensors",
      "--aspect",
      "1:1 (Square)",
      "--sampler",
      "euler_ancestral",
      "--seed",
      "7",
      "--steps",
      "40",
      "--scheduler",
      "karras",
    ]);
    expect(options.unetName).toBe("other.safetensors");
    expect(options.aspectRatio).toBe("1:1 (Square)");
    expect(options.samplerName).toBe("euler_ancestral");
    expect(options.seed).toBe(7);
    expect(options.steps).toBe(40);
    expect(options.scheduler).toBe("karras");
  });

  test("rejette un ratio ou un nombre de pas invalide", () => {
    expect(() => parseGenerateArgs(["--aspect", "4:3"])).toThrow(/--aspect inconnu/);
    expect(() => parseGenerateArgs(["--steps", "0"])).toThrow(/--steps/);
  });
});
