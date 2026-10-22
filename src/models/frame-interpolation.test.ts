import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  FRAME_INTERPOLATION_DEFAULTS,
  FrameInterpolationModel,
  buildFrameInterpolationPrompt,
  generateFrameInterpolation,
  type FrameInterpolationOptions,
} from "./frame-interpolation.ts";

const options: FrameInterpolationOptions = { ...FRAME_INTERPOLATION_DEFAULTS, video: "wan.mp4" };

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("buildFrameInterpolationPrompt", () => {
  test("relie vidéo → images → interpolation → vidéo → enregistrement", () => {
    const graph = buildFrameInterpolationPrompt(options);

    expect(graph["4"]).toEqual({ class_type: "LoadVideo", inputs: { file: "wan.mp4" }, _meta: {} });
    expect(graph["16:3"]?.inputs.video).toEqual(["4", 0]);
    expect(graph["16:2"]?.inputs).toEqual({
      interp_model: ["16:1", 0],
      images: ["16:3", 0],
      multiplier: ["16:9", 0],
    });
    expect(graph["16:5"]?.inputs).toEqual({
      images: ["16:2", 0],
      audio: ["16:3", 1],
      fps: ["16:11", 0],
    });
    expect(graph["7"]?.class_type).toBe("SaveVideo");
    expect(graph["7"]?.inputs.video).toEqual(["16:5", 0]);
  });

  test("multiplie les images/s de la source par multiplier", () => {
    const graph = buildFrameInterpolationPrompt({ ...options, multiplier: 3 });

    expect(graph["16:9"]?.inputs.value).toBe(3);
    expect(graph["16:11"]?.inputs).toEqual({
      expression: "a * b",
      "values.a": ["16:3", 2],
      "values.b": ["16:9", 0],
    });
  });

  test("garde les défauts : RIFE 4.26, ×2", () => {
    const graph = buildFrameInterpolationPrompt(options);

    expect(graph["16:1"]?.inputs.model_name).toBe("rife_v4.26.safetensors");
    expect(graph["16:9"]?.inputs.value).toBe(2);
  });

  test("place le modèle et meta sur le chargeur", () => {
    const graph = buildFrameInterpolationPrompt({ ...options, modelName: FrameInterpolationModel.Film }, { title: "run" });

    expect(graph["16:1"]?.inputs.model_name).toBe("film_net_fp16.safetensors");
    expect(graph["16:1"]?._meta).toEqual({ title: "run" });
  });
});

describe("generateFrameInterpolation", () => {
  test("envoie la vidéo, puis le graphe qui la charge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "interp-"));
    directories.push(directory);
    const source = join(directory, "wan.mp4");
    await writeFile(source, new Uint8Array([9]));
    const calls: string[] = [];
    let postedPrompt = "";

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(url.replace("http://127.0.0.1:9", ""));
      if (url.endsWith("/upload/image")) {
        return Response.json({ name: "wan (1).mp4", subfolder: "", type: "input" });
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
              "7": { images: [{ filename: "FrameInterpolation_00001_.mp4", subfolder: "", type: "output" }], animated: [true] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateFrameInterpolation(
      { ...options, video: source },
      { server: "http://127.0.0.1:9", outputDir: directory },
    );

    expect(calls.slice(0, 2)).toEqual(["/upload/image", "/prompt"]);
    const graph = JSON.parse(postedPrompt) as { prompt: Record<string, { inputs: { file?: string } }> };
    expect(graph.prompt["4"]?.inputs.file).toBe("wan (1).mp4");
    expect(paths[0]!.endsWith(".mp4")).toBe(true);
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
