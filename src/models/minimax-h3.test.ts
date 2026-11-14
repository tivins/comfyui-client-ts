import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  buildMiniMaxH3Prompt,
  generateMiniMaxH3,
  MINIMAX_H3_DEFAULTS,
  MiniMaxH3Model,
  minimaxH3FrameCount,
  type MiniMaxH3Options,
} from "./minimax-h3.ts";

const options: MiniMaxH3Options = {
  ...MINIMAX_H3_DEFAULTS,
  inputImage: "start.png",
  prompt: "The kitten from <Picture 1> plays with the yarn.",
  seed: 7,
};

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("minimaxH3FrameCount", () => {
  test("arrondit au-dessus sur la grille 17k + 5 à 24 images/s", () => {
    expect(minimaxH3FrameCount(5)).toBe(124);
    expect(minimaxH3FrameCount(1)).toBe(39);
    expect(minimaxH3FrameCount(10)).toBe(243);
    expect(minimaxH3FrameCount(15)).toBe(362);
  });

  test("garde un compte déjà sur la grille et ne descend pas sous 5", () => {
    expect(minimaxH3FrameCount(124 / 24)).toBe(124);
    expect(minimaxH3FrameCount(0)).toBe(5);
  });
});

describe("buildMiniMaxH3Prompt", () => {
  test("place l'image, le prompt, la taille, la durée et la graine", () => {
    const graph = buildMiniMaxH3Prompt(options);

    expect(graph["114"]?.class_type).toBe("LoadImage");
    expect(graph["114"]?.inputs.image).toBe("start.png");
    const i2v = graph["105:104"]?.inputs;
    expect(i2v?.prompt).toBe("The kitten from <Picture 1> plays with the yarn.");
    expect(i2v?.width).toBe(768);
    expect(i2v?.height).toBe(768);
    expect(i2v?.length).toBe(124);
    expect(i2v?.first_frame).toEqual(["114", 0]);
    expect(i2v?.last_frame).toBeUndefined();
    expect(graph["105:15"]?.inputs.noise_seed).toBe(7);
  });

  test("les défauts : NVFP4, 20 pas sans LoRA, res_multistep / simple, son relié à la vidéo", () => {
    const graph = buildMiniMaxH3Prompt(options);

    expect(graph["105:6"]?.inputs.unet_name).toBe(MiniMaxH3Model.Nvfp4);
    expect(graph["105:121"]).toBeUndefined();
    expect(graph["105:9"]?.inputs.steps).toBe(20);
    expect(graph["105:9"]?.inputs.model).toEqual(["105:6", 0]);
    expect(graph["105:16"]?.inputs.model).toEqual(["105:6", 0]);
    expect(graph["105:17"]?.inputs.sampler_name).toBe("res_multistep");
    expect(graph["105:9"]?.inputs.scheduler).toBe("simple");
    expect(graph["105:91"]?.inputs.audio).toEqual(["105:23", 0]);
    expect(graph["105:91"]?.inputs.fps).toBe(24);
    expect(graph["92"]?.class_type).toBe("SaveVideo");
  });

  test("place les pas, la durée et le modèle de diffusion", () => {
    const graph = buildMiniMaxH3Prompt({ ...options, steps: 25, duration: 10, unetName: MiniMaxH3Model.Int8 });

    expect(graph["105:9"]?.inputs.steps).toBe(25);
    expect(graph["105:104"]?.inputs.length).toBe(243);
    expect(graph["105:6"]?.inputs.unet_name).toBe("minimax_h3_fl2va_pruned_int8_convrot.safetensors");
  });

  test("turbo ajoute la LoRA 8 pas v1.1 768p et ignore steps", () => {
    const graph = buildMiniMaxH3Prompt({ ...options, turbo: true, steps: 30 });

    expect(graph["105:121"]?.inputs.lora_name).toBe("minimax_h3_fl2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors");
    expect(graph["105:121"]?.inputs.model).toEqual(["105:6", 0]);
    expect(graph["105:9"]?.inputs.model).toEqual(["105:121", 0]);
    expect(graph["105:16"]?.inputs.model).toEqual(["105:121", 0]);
    expect(graph["105:9"]?.inputs.steps).toBe(8);
  });

  test("loras s'enchaînent après la diffusion et alimentent scheduler et guider", () => {
    const graph = buildMiniMaxH3Prompt({
      ...options,
      loras: [{ model: "a.safetensors", weight: 0.4 }, { model: "b.safetensors", weight: 1 }],
    });

    expect(graph["130"]?.class_type).toBe("LoraLoaderModelOnly");
    expect(graph["130"]?.inputs).toEqual({ lora_name: "a.safetensors", strength_model: 0.4, model: ["105:6", 0] });
    expect(graph["131"]?.inputs).toEqual({ lora_name: "b.safetensors", strength_model: 1, model: ["130", 0] });
    expect(graph["105:9"]?.inputs.model).toEqual(["131", 0]);
    expect(graph["105:16"]?.inputs.model).toEqual(["131", 0]);
  });

  test("avec turbo, les loras suivent la LoRA Turbo", () => {
    const graph = buildMiniMaxH3Prompt({ ...options, turbo: true, loras: [{ model: "a.safetensors", weight: 0.4 }] });

    expect(graph["105:121"]?.inputs.model).toEqual(["105:6", 0]);
    expect(graph["130"]?.inputs.model).toEqual(["105:121", 0]);
    expect(graph["105:9"]?.inputs.model).toEqual(["130", 0]);
    expect(graph["105:16"]?.inputs.model).toEqual(["130", 0]);
  });

  test("lastImage ajoute la dernière image", () => {
    const graph = buildMiniMaxH3Prompt({ ...options, lastImage: "end.png" });

    expect(graph["117"]?.inputs.image).toBe("end.png");
    expect(graph["105:104"]?.inputs.last_frame).toEqual(["117", 0]);
  });

  test("ajoute meta au _meta de la première image", () => {
    expect(buildMiniMaxH3Prompt(options)["114"]?._meta).toEqual({ title: "Charger Image" });
    expect(buildMiniMaxH3Prompt(options, { run: "a" })["114"]?._meta).toEqual({ title: "Charger Image", run: "a" });
  });
});

describe("generateMiniMaxH3", () => {
  test("envoie les deux images locales, puis le graphe avec settings.meta, et écrit la vidéo", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "minimax-h3-"));
    directories.push(outputDir);
    const start = join(outputDir, "start.png");
    const end = join(outputDir, "end.png");
    await Bun.write(start, new Uint8Array([9]));
    await Bun.write(end, new Uint8Array([8]));
    let postedPrompt = "";
    const calls: string[] = [];
    let uploads = 0;

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(new URL(url).pathname);
      if (url.endsWith("/upload/image")) {
        uploads += 1;
        return Response.json({ name: uploads === 1 ? "start (1).png" : "end.png", subfolder: "" });
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
              "92": { images: [{ filename: "clip.mp4", subfolder: "video", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([4, 5]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateMiniMaxH3(
      { ...options, inputImage: start, lastImage: end },
      { server: "http://127.0.0.1:9", outputDir, meta: { run: "a" } },
    );

    const graph = JSON.parse(postedPrompt) as {
      prompt: Record<string, { inputs: { image?: string }; _meta: Record<string, unknown> }>;
    };
    expect(calls.slice(0, 3)).toEqual(["/upload/image", "/upload/image", "/prompt"]);
    expect(graph.prompt["114"]?.inputs.image).toBe("start (1).png");
    expect(graph.prompt["117"]?.inputs.image).toBe("end.png");
    expect(graph.prompt["114"]?._meta.run).toBe("a");
    expect(paths[0]).toEndWith("-clip.mp4");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([4, 5]));
  });
});
