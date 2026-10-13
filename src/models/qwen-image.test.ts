import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  QWEN_IMAGE_DEFAULTS,
  buildQwenImagePrompt,
  generateQwenImage,
  type QwenImageOptions,
} from "./qwen-image.ts";

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

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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

describe("generateQwenImage", () => {
  test("envoie le graphe, attend l'historique et écrit l'image", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qwen-image-"));
    directories.push(outputDir);
    let postedPrompt = "";

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/prompt")) {
        postedPrompt = String(init?.body);
        return Response.json({ prompt_id: "abc" });
      }
      if (url.endsWith("/history/abc")) {
        return Response.json({
          abc: {
            status: { completed: true, status_str: "success" },
            outputs: {
              "9": { images: [{ filename: "kettle.png", subfolder: "", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    };

    const paths = await generateQwenImage(baseOptions, {
      server: "http://127.0.0.1:9",
      outputDir,
    });

    const graph = JSON.parse(postedPrompt) as { prompt: Record<string, { inputs: { prompt?: string } }> };
    expect(graph.prompt["484"]?.inputs.prompt).toBe("a red kettle");
    expect(paths[0]).toStartWith(outputDir);
    expect(paths[0]).toEndWith("-kettle.png");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
