import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import type { ApiPrompt } from "../workflow.ts";
import {
  ColorCorrection,
  SEEDVR2_DEFAULTS,
  buildSeedVR2Prompt,
  generateSeedVR2Upscale,
  type SeedVR2Options,
} from "./seedvr2.ts";

const options: SeedVR2Options = { ...SEEDVR2_DEFAULTS, image: "cat.png" };

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

describe("buildSeedVR2Prompt", () => {
  test("reproduit le graphe exporté depuis l'interface, sans ImageCompare", () => {
    const exported = JSON.parse(
      readFileSync(new URL("../../../docs/workflow_utility_seedvr2_7b_int8_upscale_image.json", import.meta.url), "utf8"),
    ) as ApiPrompt;
    delete exported["65"];
    exported["9"]!.inputs.filename_prefix = "SeedVR2";

    const graph = buildSeedVR2Prompt({
      ...options,
      image: "indoor_portrait.png",
      colorCorrection: ColorCorrection.None,
      seed: 959948902156062,
    });

    expect(withoutMeta(graph)).toEqual(withoutMeta(exported));
  });

  test("fixe le grand côté avec longerSide", () => {
    const graph = buildSeedVR2Prompt({ ...options, resize: { longerSide: 3840 } });

    expect(graph["66:57"]?.inputs).toEqual({
      resize_type: "scale longer dimension",
      "resize_type.longer_size": 3840,
      scale_method: "lanczos",
      input: ["66:50", 0],
    });
  });

  test("place les tuiles, la correction de couleur et le modèle", () => {
    const graph = buildSeedVR2Prompt(
      { ...options, tileSize: 384, tileOverlap: 64, colorCorrection: ColorCorrection.Wavelet, unetName: "seedvr2_3b_int8_convrot.safetensors" },
      { title: "run" },
    );

    expect(graph["66:48"]?.inputs.tile_size).toBe(384);
    expect(graph["66:55"]?.inputs.overlap).toBe(64);
    expect(graph["66:59"]?.inputs.color_correction_method).toBe("wavelet");
    expect(graph["66:52"]?.inputs.unet_name).toBe("seedvr2_3b_int8_convrot.safetensors");
    expect(graph["66:52"]?._meta).toEqual({ title: "run" });
  });

  test("garde les défauts : ×4, correction lab, modèle 7B", () => {
    const graph = buildSeedVR2Prompt(options);

    expect(graph["66:57"]?.inputs["resize_type.multiplier"]).toBe(4);
    expect(graph["66:59"]?.inputs.color_correction_method).toBe("lab");
    expect(graph["66:52"]?.inputs.unet_name).toBe("seedvr2_7b_int8_convrot.safetensors");
  });
});

describe("generateSeedVR2Upscale", () => {
  test("envoie l'image, puis le graphe qui la charge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "seedvr2-"));
    directories.push(directory);
    const source = join(directory, "cat.png");
    await writeFile(source, new Uint8Array([9]));
    const calls: string[] = [];
    let postedPrompt = "";

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(url.replace("http://127.0.0.1:9", ""));
      if (url.endsWith("/upload/image")) {
        return Response.json({ name: "cat (1).png", subfolder: "", type: "input" });
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
              "9": { images: [{ filename: "SeedVR2_00001_.png", subfolder: "", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateSeedVR2Upscale(
      { ...options, image: source },
      { server: "http://127.0.0.1:9", outputDir: directory },
    );

    expect(calls.slice(0, 2)).toEqual(["/upload/image", "/prompt"]);
    const graph = JSON.parse(postedPrompt) as { prompt: Record<string, { inputs: { image?: string } }> };
    expect(graph.prompt["1"]?.inputs.image).toBe("cat (1).png");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
