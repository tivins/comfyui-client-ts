import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  MINIMAX_H3_IMAGE_DEFAULTS,
  MiniMaxH3ImageModel,
  buildMiniMaxH3ImagePrompt,
  generateMiniMaxH3Image,
  type MiniMaxH3ImageOptions,
} from "./minimax-h3-image.ts";

const options: MiniMaxH3ImageOptions = {
  ...MINIMAX_H3_IMAGE_DEFAULTS,
  prompt: "a plush fox floating above a summer meadow",
};

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("buildMiniMaxH3ImagePrompt", () => {
  test("sans image : texte vers image, taille laissée au nœud", () => {
    const graph = buildMiniMaxH3ImagePrompt(options);

    expect(Object.values(graph).some((node) => node.class_type === "LoadImage")).toBe(false);
    expect(graph["1"]?.inputs.unet_name).toBe(MiniMaxH3ImageModel.W4a8);
    expect(graph["2"]?.inputs).toEqual({
      clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      type: "minimax",
      device: "default",
    });
    expect(graph["3"]?.inputs.vae_name).toBe("minimax_h3_image_vae_fp16.safetensors");
    expect(graph["5"]?.class_type).toBe("MiniMaxH3ImageConditioning");
    expect(graph["5"]?.inputs).toEqual({
      clip: ["2", 0],
      vae: ["3", 0],
      prompt: options.prompt,
      width: 0,
      height: 0,
    });
    expect(graph["6"]?.inputs.conditioning).toEqual(["5", 0]);
    expect(graph["7"]?.inputs).toMatchObject({
      positive: ["5", 0],
      negative: ["6", 0],
      latent_image: ["5", 1],
      steps: 6,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "simple",
    });
  });

  test("les images vont dans l'ordre sur images.image_1, images.image_2", () => {
    const graph = buildMiniMaxH3ImagePrompt({
      ...options,
      referenceImages: ["taxi.png", "truck.png"],
      width: 2048,
      height: 1536,
      seed: 7,
    });

    expect(graph["100"]).toEqual({ class_type: "LoadImage", inputs: { image: "taxi.png" }, _meta: {} });
    expect(graph["101"]?.inputs.image).toBe("truck.png");
    expect(graph["5"]?.inputs["images.image_1"]).toEqual(["100", 0]);
    expect(graph["5"]?.inputs["images.image_2"]).toEqual(["101", 0]);
    expect(graph["5"]?.inputs.width).toBe(2048);
    expect(graph["5"]?.inputs.height).toBe(1536);
    expect(graph["7"]?.inputs.seed).toBe(7);
  });

  test("refuse plus de 100 images", () => {
    const referenceImages = Array.from({ length: 101 }, (_, i) => `${i}.png`);
    expect(() => buildMiniMaxH3ImagePrompt({ ...options, referenceImages })).toThrow("100 au plus");
  });

  test("meta va dans le _meta de l'UNET", () => {
    const graph = buildMiniMaxH3ImagePrompt(options, { image_preset: "h3" });
    expect(graph["1"]?._meta).toEqual({ image_preset: "h3" });
  });
});

describe("generateMiniMaxH3Image", () => {
  test("envoie chaque image, puis le graphe qui les charge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "minimax-h3-image-"));
    directories.push(directory);
    const taxi = join(directory, "taxi.png");
    const truck = join(directory, "truck.png");
    await writeFile(taxi, new Uint8Array([1]));
    await writeFile(truck, new Uint8Array([2]));
    const calls: string[] = [];
    let uploads = 0;
    let postedPrompt = "";

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(url.replace("http://127.0.0.1:9", ""));
      if (url.endsWith("/upload/image")) {
        uploads++;
        return Response.json({ name: `ref${uploads}.png`, subfolder: "", type: "input" });
      }
      if (url.endsWith("/prompt")) {
        postedPrompt = String(init?.body);
        return Response.json({ prompt_id: "abc" });
      }
      if (url.endsWith("/history/abc")) {
        return Response.json({
          abc: {
            status: { completed: true, status_str: "success" },
            outputs: { "9": { images: [{ filename: "edit.png", subfolder: "", type: "output" }] } },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateMiniMaxH3Image(
      { ...options, referenceImages: [taxi, truck] },
      { server: "http://127.0.0.1:9", outputDir: directory },
    );

    expect(calls.slice(0, 3)).toEqual(["/upload/image", "/upload/image", "/prompt"]);
    const graph = JSON.parse(postedPrompt) as { prompt: Record<string, { inputs: { image?: string } }> };
    expect(graph.prompt["100"]?.inputs.image).toBe("ref1.png");
    expect(graph.prompt["101"]?.inputs.image).toBe("ref2.png");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
