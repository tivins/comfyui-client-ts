import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { buildWan22Prompt, generateWan22, WAN22_DEFAULTS, type Wan22Options } from "./wan22.ts";

const options: Wan22Options = {
  ...WAN22_DEFAULTS,
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

  test("les défauts gardent le workflow d'origine : sans LoRA 4 pas, 20 pas, cfg 3.5, 5 s", () => {
    const graph = buildWan22Prompt(options);

    expect(graph["129:131"]?.inputs.value).toBe(false);
    expect(graph["129:128"]?.inputs.value).toBe(20);
    expect(graph["129:127"]?.inputs.value).toBe(10);
    expect(graph["129:126"]?.inputs.value).toBe(3.5);
    expect(graph["129:161"]?.inputs.value).toBe(5);
    expect(String(graph["129:89"]?.inputs.text)).toStartWith("色调艳丽");
    expect(graph["108"]?.class_type).toBe("SaveVideo");
  });

  test("place les pas, la coupure, le cfg, la durée et le négatif", () => {
    const graph = buildWan22Prompt({ ...options, steps: 30, splitStep: 15, cfg: 4, duration: 3, negativePrompt: "blur" });

    expect(graph["129:128"]?.inputs.value).toBe(30);
    expect(graph["129:127"]?.inputs.value).toBe(15);
    expect(graph["129:126"]?.inputs.value).toBe(4);
    expect(graph["129:161"]?.inputs.value).toBe(3);
    expect(graph["129:89"]?.inputs.text).toBe("blur");
  });

  test("lightning allume la LoRA 4 pas, dont les valeurs restent fixes", () => {
    const graph = buildWan22Prompt({ ...options, lightning: true, steps: 30 });

    expect(graph["129:131"]?.inputs.value).toBe(true);
    expect(graph["129:118"]?.inputs.value).toBe(4);
    expect(graph["129:124"]?.inputs.value).toBe(2);
    expect(graph["129:122"]?.inputs.value).toBe(1);
  });

  test("ajoute meta au _meta de l'image d'entrée", () => {
    expect(buildWan22Prompt(options)["97"]?._meta).toEqual({ title: "Charger Image" });
    expect(buildWan22Prompt(options, { run: "a" })["97"]?._meta).toEqual({ title: "Charger Image", run: "a" });
  });
});

describe("generateWan22", () => {
  test("envoie l'image locale, puis le graphe avec settings.meta, et écrit la vidéo", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "wan22-"));
    directories.push(outputDir);
    const start = join(outputDir, "start.png");
    await Bun.write(start, new Uint8Array([9]));
    let postedPrompt = "";
    const calls: string[] = [];

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(new URL(url).pathname);
      if (url.endsWith("/upload/image")) {
        return Response.json({ name: "start (1).png", subfolder: "" });
      }
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

    const paths = await generateWan22({ ...options, inputImage: start }, { server: "http://127.0.0.1:9", outputDir, meta: { run: "a" } });

    const graph = JSON.parse(postedPrompt) as {
      prompt: Record<string, { inputs: { image?: string }; _meta: Record<string, unknown> }>;
    };
    expect(calls.slice(0, 2)).toEqual(["/upload/image", "/prompt"]);
    expect(graph.prompt["97"]?.inputs.image).toBe("start (1).png");
    expect(graph.prompt["97"]?._meta.run).toBe("a");
    expect(paths[0]).toEndWith("-clip.mp4");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([4, 5]));
  });
});
