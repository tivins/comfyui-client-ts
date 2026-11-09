import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  FLUX3_KLEIN_DEFAULTS,
  buildFlux3KleinPrompt,
  generateFlux3Klein,
  type Flux3KleinOptions,
} from "./flux3-klein.ts";

const options: Flux3KleinOptions = {
  ...FLUX3_KLEIN_DEFAULTS,
  prompt: "the man from the first image and the woman from the second image at a desk",
  referenceImages: [],
};

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("buildFlux3KleinPrompt", () => {
  test("sans référence : texte vers image, sans ReferenceMultiLatent", () => {
    const graph = buildFlux3KleinPrompt(options);

    expect(graph["136"]).toBeUndefined();
    expect(Object.values(graph).some((node) => node.class_type === "LoadImage")).toBe(false);
    expect(graph["104"]?.inputs.text).toBe(options.prompt);
    expect(graph["102"]?.inputs.type).toBe("flux3");
    expect(graph["102"]?.inputs.clip_name).toBe("qwen3vl_4b_int8_convrot.safetensors");
    expect(graph["101"]?.inputs.unet_name).toBe("flux3-image-klein-int8-convrot.safetensors");
    expect(graph["103"]?.inputs.vae_name).toBe("flux2-vae.safetensors");
    expect(graph["107"]?.inputs.positive).toEqual(["104", 0]);
    expect(graph["107"]?.inputs.negative).toEqual(["105", 0]);
    expect(graph["107"]?.inputs.cfg).toBe(1);
    expect(graph["107"]?.inputs.steps).toBe(16);
    expect(graph["139"]?.class_type).toBe("EmptyFlux2LatentImage");
  });

  test("alpha devient le shift ln(alpha) de ModelSamplingFlux", () => {
    const graph = buildFlux3KleinPrompt({ ...options, alpha: 16 });

    expect(graph["132"]?.inputs.max_shift).toBeCloseTo(2.77259, 4);
    expect(graph["132"]?.inputs.base_shift).toBeCloseTo(2.77259, 4);
  });

  test("les références vont dans l'ordre sur images.image0, images.image1", () => {
    const graph = buildFlux3KleinPrompt({
      ...options,
      referenceImages: ["man.png", "woman.png"],
      referenceMegapixels: 0.5,
      width: 1280,
      height: 720,
      seed: 7,
      batchSize: 2,
    });

    expect(graph["150"]).toEqual({ class_type: "LoadImage", inputs: { image: "man.png" }, _meta: {} });
    expect(graph["151"]?.inputs.image).toBe("woman.png");
    expect(graph["136"]?.class_type).toBe("ReferenceMultiLatent");
    expect(graph["136"]?.inputs["images.image0"]).toEqual(["150", 0]);
    expect(graph["136"]?.inputs["images.image1"]).toEqual(["151", 0]);
    expect(graph["136"]?.inputs.resolution).toBe("resize");
    expect(graph["136"]?.inputs["resolution.megapixels"]).toBe(0.5);
    expect(graph["107"]?.inputs.positive).toEqual(["136", 0]);
    expect(graph["107"]?.inputs.negative).toEqual(["136", 1]);
    expect(graph["107"]?.inputs.seed).toBe(7);
    expect(graph["139"]?.inputs).toEqual({ width: 1280, height: 720, batch_size: 2 });
  });

  test("refuse plus de 10 références", () => {
    const referenceImages = Array.from({ length: 11 }, (_, i) => `${i}.png`);
    expect(() => buildFlux3KleinPrompt({ ...options, referenceImages })).toThrow("10 au plus");
  });

  test("meta va dans le _meta de l'UNET", () => {
    const graph = buildFlux3KleinPrompt(options, { image_preset: "flux" });
    expect(graph["101"]?._meta).toEqual({ image_preset: "flux" });
  });
});

describe("generateFlux3Klein", () => {
  test("envoie chaque référence, puis le graphe qui les charge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flux3-klein-"));
    directories.push(directory);
    const man = join(directory, "man.png");
    const woman = join(directory, "woman.png");
    await writeFile(man, new Uint8Array([1]));
    await writeFile(woman, new Uint8Array([2]));
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
            outputs: { "9": { images: [{ filename: "scene.png", subfolder: "", type: "output" }] } },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateFlux3Klein(
      { ...options, referenceImages: [man, woman] },
      { server: "http://127.0.0.1:9", outputDir: directory },
    );

    expect(calls.slice(0, 3)).toEqual(["/upload/image", "/upload/image", "/prompt"]);
    const graph = JSON.parse(postedPrompt) as { prompt: Record<string, { inputs: { image?: string } }> };
    expect(graph.prompt["150"]?.inputs.image).toBe("ref1.png");
    expect(graph.prompt["151"]?.inputs.image).toBe("ref2.png");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
