import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { buildWan22Prompt, generateWan22, type Wan22Options } from "./wan22.ts";

const options: Wan22Options = {
  inputImage: "start.png",
  prompt: "the cat turns its head",
  width: 640,
  height: 640,
  seed: 7,
  fps: 16,
};

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("buildWan22Prompt", () => {
  test("place l'image, le prompt, la taille, la graine et le fps", () => {
    const graph = buildWan22Prompt(options);

    expect(graph["97"]?.class_type).toBe("LoadImage");
    expect(graph["97"]?.inputs.image).toBe("start.png");
    expect(graph["129:93"]?.inputs.text).toBe("the cat turns its head");
    expect(graph["129:98"]?.inputs.width).toBe(640);
    expect(graph["129:98"]?.inputs.height).toBe(640);
    expect(graph["129:98"]?.inputs.start_image).toEqual(["97", 0]);
    expect(graph["129:86"]?.inputs.noise_seed).toBe(7);
    expect(graph["129:162"]?.inputs.value).toBe(16);
  });

  test("garde le workflow d'origine : sans LoRA 4 pas, 20 pas, cfg 3.5", () => {
    const graph = buildWan22Prompt(options);

    expect(graph["129:131"]?.inputs.value).toBe(false);
    expect(graph["129:128"]?.inputs.value).toBe(20);
    expect(graph["129:127"]?.inputs.value).toBe(10);
    expect(graph["129:126"]?.inputs.value).toBe(3.5);
    expect(graph["108"]?.class_type).toBe("SaveVideo");
  });

  test("ajoute meta au _meta de l'image d'entrée", () => {
    expect(buildWan22Prompt(options)["97"]?._meta).toEqual({ title: "Charger Image" });
    expect(buildWan22Prompt(options, { run: "a" })["97"]?._meta).toEqual({ title: "Charger Image", run: "a" });
  });
});

describe("generateWan22", () => {
  test("envoie le graphe avec settings.meta et écrit la vidéo", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "wan22-"));
    directories.push(outputDir);
    let postedPrompt = "";

    globalThis.fetch = (async (input, init) => {
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
              "108": { images: [{ filename: "clip.mp4", subfolder: "video", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([4, 5]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateWan22(options, { server: "http://127.0.0.1:9", outputDir, meta: { run: "a" } });

    const graph = JSON.parse(postedPrompt) as {
      prompt: Record<string, { inputs: { image?: string }; _meta: Record<string, unknown> }>;
    };
    expect(graph.prompt["97"]?.inputs.image).toBe("start.png");
    expect(graph.prompt["97"]?._meta.run).toBe("a");
    expect(paths[0]).toEndWith("-clip.mp4");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([4, 5]));
  });
});
