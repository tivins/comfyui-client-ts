import { describe, expect, test } from "bun:test";

import { parseGenerateArgs } from "./generate.ts";
import { QWEN_IMAGE_DEFAULTS, buildQwenImagePrompt, type QwenImageOptions } from "./workflow.ts";

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
