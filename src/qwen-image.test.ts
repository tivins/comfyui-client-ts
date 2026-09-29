import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { clearHistory, generateQwenImage } from "./qwen-image.ts";
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

  test("retire l'image de l'historique et le prompt de la file", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qwen-image-"));
    directories.push(outputDir);
    const calls: string[] = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/prompt")) return Response.json({ prompt_id: "abc" });
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
        return new Response(new Uint8Array([1]));
      }
      if ((url.endsWith("/history") || url.endsWith("/queue")) && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ delete: ["abc"] });
        return new Response(null, { status: 200 });
      }
      throw new Error(`requête inattendue : ${url}`);
    };

    await generateQwenImage(baseOptions, {
      server: "http://127.0.0.1:9",
      outputDir,
      deleteFromServer: true,
    });

    const view = calls.findIndex((call) => call.startsWith("GET http://127.0.0.1:9/view?"));
    const history = calls.findIndex((call) => call === "POST http://127.0.0.1:9/history");
    const queue = calls.findIndex((call) => call === "POST http://127.0.0.1:9/queue");
    expect(view).toBeGreaterThan(-1);
    expect(history).toBeGreaterThan(view);
    expect(queue).toBeGreaterThan(history);
  });

  test("laisse l'historique en place sans deleteFromServer", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "qwen-image-"));
    directories.push(outputDir);
    const calls: string[] = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/prompt")) return Response.json({ prompt_id: "abc" });
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
      if (url.startsWith("http://127.0.0.1:9/view?")) return new Response(new Uint8Array([1]));
      throw new Error(`requête inattendue : ${url}`);
    };

    await generateQwenImage(baseOptions, { server: "http://127.0.0.1:9", outputDir });
    expect(calls.some((call) => call.startsWith("POST "))).toBe(true);
    expect(calls.some((call) => call === "POST http://127.0.0.1:9/history")).toBe(false);
    expect(calls.some((call) => call === "POST http://127.0.0.1:9/queue")).toBe(false);
  });

  test("remonte le refus de ComfyUI", async () => {
    globalThis.fetch = async () => Response.json({ error: "bad graph" }, { status: 400 });

    await expect(generateQwenImage(baseOptions, { server: "http://127.0.0.1:9" })).rejects.toThrow(
      /a refusé le graphe \(400\)/,
    );
  });
});

describe("clearHistory", () => {
  test("vide l'historique ComfyUI", async () => {
    let body = "";
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:9/history");
      expect(init?.method).toBe("POST");
      body = String(init?.body);
      return new Response(null, { status: 200 });
    };

    await clearHistory("http://127.0.0.1:9/");
    expect(JSON.parse(body)).toEqual({ clear: true });
  });

  test("remonte le refus du serveur", async () => {
    globalThis.fetch = async () => new Response(null, { status: 500 });
    await expect(clearHistory("http://127.0.0.1:9")).rejects.toThrow(/POST \/history \(clear\) a répondu 500/);
  });
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
