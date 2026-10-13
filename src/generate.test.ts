import { describe, expect, test } from "bun:test";

import { parseGenerateArgs } from "./generate.ts";
import { QWEN_IMAGE_DEFAULTS } from "./models/qwen-image.ts";

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
