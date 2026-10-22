import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import type { ApiPrompt } from "../workflow.ts";
import { ColorCorrection } from "./seedvr2.ts";
import {
  CHUNK_OVERLAP,
  SEEDVR2_VIDEO_DEFAULTS,
  buildSeedVR2VideoPrompt,
  generateSeedVR2VideoUpscale,
  type SeedVR2VideoOptions,
} from "./seedvr2-video.ts";

const options: SeedVR2VideoOptions = { ...SEEDVR2_VIDEO_DEFAULTS, video: "wan.mp4" };

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Garde `class_type` et `inputs`, comme le graphe envoyé par l'interface. */
function withoutMeta(graph: ApiPrompt) {
  return Object.fromEntries(
    Object.entries(graph).map(([id, node]) => [id, { class_type: node.class_type, inputs: node.inputs }]),
  );
}

/** Le graphe exporté, interrupteurs résolus : sans `Video Slice` ni découpage. */
function exportedWithoutSwitches(): ApiPrompt {
  const exported = JSON.parse(
    readFileSync(new URL("../../workflows/workflow_utility_seedvr2_3b_int8_upscale_video.json", import.meta.url), "utf8"),
  ) as ApiPrompt;
  for (const id of ["66:79", "66:81", "66:99", "66:100", "66:102", "66:103", "66:105"]) {
    delete exported[id];
  }
  exported["66:74"]!.inputs.video = ["73", 0];
  exported["66:61"]!.inputs.vae_conditioning = ["66:48", 0];
  exported["66:54"]!.inputs.latent_image = ["66:48", 0];
  exported["66:55"]!.inputs.samples = ["66:54", 0];
  exported["76"]!.inputs.filename_prefix = "SeedVR2Video";
  return exported;
}

describe("buildSeedVR2VideoPrompt", () => {
  test("reproduit le graphe exporté, sans Video Slice ni découpage, avec framesPerChunk null", () => {
    const graph = buildSeedVR2VideoPrompt({
      ...options,
      video: "grainy_perfume_shot_crf32.mp4",
      unetName: "seedvr2_3b_int8_convrot.safetensors",
      colorCorrection: ColorCorrection.None,
      seed: 959948902156062,
      framesPerChunk: null,
    });

    expect(withoutMeta(graph)).toEqual(withoutMeta(exportedWithoutSwitches()));
  });

  test("découpe le latent en morceaux de framesPerChunk images, puis les recolle", () => {
    const graph = buildSeedVR2VideoPrompt({ ...options, framesPerChunk: 21 });

    expect(graph["66:99"]).toEqual({
      class_type: "SeedVR2TemporalChunk",
      inputs: {
        temporal_overlap: CHUNK_OVERLAP,
        chunking_mode: "manual",
        "chunking_mode.frames_per_chunk": 21,
        latent: ["66:48", 0],
      },
      _meta: {},
    });
    expect(graph["66:61"]?.inputs.vae_conditioning).toEqual(["66:99", 0]);
    expect(graph["66:54"]?.inputs.latent_image).toEqual(["66:99", 0]);
    expect(graph["66:100"]?.inputs).toEqual({ latents: ["66:54", 0], temporal_overlap: ["66:99", 1] });
    expect(graph["66:55"]?.inputs.samples).toEqual(["66:100", 0]);
  });

  test("sans découpage, ni SeedVR2TemporalChunk ni SeedVR2TemporalMerge", () => {
    const graph = buildSeedVR2VideoPrompt({ ...options, framesPerChunk: null });

    expect(graph["66:99"]).toBeUndefined();
    expect(graph["66:100"]).toBeUndefined();
  });

  test("remonte la vidéo avec les images/s, la profondeur et l'audio d'origine", () => {
    const graph = buildSeedVR2VideoPrompt(options);

    expect(graph["73"]).toEqual({ class_type: "LoadVideo", inputs: { file: "wan.mp4" }, _meta: {} });
    expect(graph["66:57"]?.inputs.input).toEqual(["66:74", 0]);
    expect(graph["66:75"]?.inputs).toMatchObject({
      fps: ["66:74", 2],
      bit_depth: ["66:74", 3],
      audio: ["66:74", 1],
      images: ["66:59", 0],
    });
    expect(graph["76"]?.inputs.video).toEqual(["66:75", 0]);
  });

  test("fixe le grand côté avec longerSide, place les tuiles et meta", () => {
    const graph = buildSeedVR2VideoPrompt(
      { ...options, resize: { longerSide: 1920 }, tileSize: 384, tileOverlap: 64 },
      { title: "run" },
    );

    expect(graph["66:57"]?.inputs).toEqual({
      resize_type: "scale longer dimension",
      "resize_type.longer_size": 1920,
      scale_method: "lanczos",
      input: ["66:74", 0],
    });
    expect(graph["66:48"]?.inputs).toMatchObject({ tile_size: 384, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
    expect(graph["66:55"]?.inputs).toMatchObject({ tile_size: 384, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
    expect(graph["66:52"]?._meta).toEqual({ title: "run" });
  });

  test("garde les défauts : ×2, correction lab, modèle 7B, morceaux de 33 images", () => {
    const graph = buildSeedVR2VideoPrompt(options);

    expect(graph["66:57"]?.inputs["resize_type.multiplier"]).toBe(2);
    expect(graph["66:59"]?.inputs.color_correction_method).toBe("lab");
    expect(graph["66:52"]?.inputs.unet_name).toBe("seedvr2_7b_int8_convrot.safetensors");
    expect(graph["66:99"]?.inputs["chunking_mode.frames_per_chunk"]).toBe(33);
    expect(graph["66:52"]?._meta).toEqual({});
  });
});

describe("generateSeedVR2VideoUpscale", () => {
  test("envoie la vidéo, puis le graphe qui la charge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seedvr2-video-"));
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
              "76": { images: [{ filename: "SeedVR2Video_00001_.mp4", subfolder: "", type: "output" }], animated: [true] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateSeedVR2VideoUpscale(
      { ...options, video: source },
      { server: "http://127.0.0.1:9", outputDir: directory, meta: { title: "clip" } },
    );

    expect(calls.slice(0, 2)).toEqual(["/upload/image", "/prompt"]);
    const graph = JSON.parse(postedPrompt) as { prompt: ApiPrompt };
    expect(graph.prompt["73"]?.inputs.file).toBe("wan (1).mp4");
    expect(graph.prompt["66:52"]?._meta).toEqual({ title: "clip" });
    expect(paths[0]!.endsWith(".mp4")).toBe(true);
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
