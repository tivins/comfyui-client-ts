import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { generateQwenImage } from "./qwen-image.ts";
import { options as exampleOptions } from "./example.ts";
import { QWEN_IMAGE_DEFAULTS, type QwenImageOptions } from "./workflow.ts";

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
    expect(paths).toEqual([join(outputDir, "kettle.png")]);
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("remonte le refus de ComfyUI", async () => {
    globalThis.fetch = async () => Response.json({ error: "bad graph" }, { status: 400 });

    await expect(generateQwenImage(baseOptions, { server: "http://127.0.0.1:9" })).rejects.toThrow(
      /a refusé le graphe \(400\)/,
    );
  });
});

describe("example", () => {
  test("fixe un QwenImageOptions complet", () => {
    expect(exampleOptions.prompt).toBe("a young cat walking on a table, daylight");
    expect(exampleOptions.negativePrompt).toBe("blur,bad quality");
    expect(exampleOptions.unetName).toBe(QWEN_IMAGE_DEFAULTS.unetName);
    expect(exampleOptions.aspectRatio).toBe(QWEN_IMAGE_DEFAULTS.aspectRatio);
    expect(exampleOptions.samplerName).toBe(QWEN_IMAGE_DEFAULTS.samplerName);
    expect(exampleOptions.seed).toBe(QWEN_IMAGE_DEFAULTS.seed);
    expect(exampleOptions.steps).toBe(QWEN_IMAGE_DEFAULTS.steps);
    expect(exampleOptions.scheduler).toBe(QWEN_IMAGE_DEFAULTS.scheduler);
  });
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
