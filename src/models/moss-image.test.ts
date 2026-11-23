import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  MOSS_IMAGE_DEFAULTS,
  MOSS_IMAGE_PREFIX,
  MossBoxKind,
  buildMossImagePrompt,
  generateMossImage,
  type MossBox,
  type MossImageOptions,
} from "./moss-image.ts";

const options: MossImageOptions = {
  ...MOSS_IMAGE_DEFAULTS,
  prompt: "Photograph of a café terrace",
  negativePrompt: "worst quality",
};

const boxes: MossBox[] = [
  { x: 48, y: 224, width: 384, height: 800, kind: MossBoxKind.Character, description: "A young woman" },
  { x: 704, y: 368, width: 288, height: 448, kind: MossBoxKind.Object, description: "A teapot" },
  { x: 288, y: 32, width: 448, height: 128, kind: MossBoxKind.Text, text: "Café des Amis", description: "A painted sign" },
  { x: 624, y: 288, width: 368, height: 736, kind: MossBoxKind.Character, description: "An old man" },
];

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("buildMossImagePrompt", () => {
  test("sans boîte : le prompt va droit à l'encodeur", () => {
    const graph = buildMossImagePrompt(options);

    expect(graph["20"]).toBeUndefined();
    expect(graph["21"]).toBeUndefined();
    expect(graph["1"]?.inputs.unet_name).toBe("moss_image_sft_bf16.safetensors");
    expect(graph["2"]?.inputs).toEqual({
      clip_name: "qwen3.5_9b_int8_convrot.safetensors",
      type: "moss_image",
      device: "default",
    });
    expect(graph["3"]?.inputs.vae_name).toBe("flux2-vae.safetensors");
    expect(graph["4"]?.inputs.text).toBe(options.prompt);
    expect(graph["5"]?.inputs.text).toBe(options.negativePrompt);
    expect(graph["6"]?.inputs).toEqual({ width: 1024, height: 1024, batch_size: 1 });
    expect(graph["15"]?.inputs).toEqual({
      model: ["1", 0],
      double_layers: "",
      single_layers: "22",
      start_percent: 0,
      end_percent: 0.5,
    });
    expect(graph["7"]?.inputs).toMatchObject({
      model: ["15", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      latent_image: ["6", 0],
      seed: 42,
      steps: 25,
      cfg: 2.5,
      sampler_name: "er_sde",
      scheduler: "simple",
    });
    expect(graph["9"]?.inputs.filename_prefix).toBe(MOSS_IMAGE_PREFIX);
  });

  test("skipLayerGuidance à null retire le nœud", () => {
    const graph = buildMossImagePrompt({ ...options, skipLayerGuidance: null });
    expect(graph["15"]).toBeUndefined();
    expect(graph["7"]?.inputs.model).toEqual(["1", 0]);
  });

  test("les boîtes passent par CreateBoundingBoxes et MOSSImageLayoutPrompt", () => {
    const graph = buildMossImagePrompt({ ...options, boxes });

    expect(graph["20"]?.class_type).toBe("CreateBoundingBoxes");
    expect(graph["20"]?.inputs.width).toBe(1024);
    expect(graph["20"]?.inputs.editor_state).toEqual({
      __value__: [
        { x: 48, y: 224, width: 384, height: 800, metadata: { type: "obj", text: "", desc: "A young woman", palette: [] } },
        { x: 704, y: 368, width: 288, height: 448, metadata: { type: "obj", text: "", desc: "A teapot", palette: [] } },
        { x: 288, y: 32, width: 448, height: 128, metadata: { type: "text", text: "Café des Amis", desc: "A painted sign", palette: [] } },
        { x: 624, y: 288, width: 368, height: 736, metadata: { type: "obj", text: "", desc: "An old man", palette: [] } },
      ],
    });
    expect(graph["21"]?.inputs).toEqual({
      prompt: options.prompt,
      element: ["20", 2],
      width: 1024,
      height: 1024,
      character_boxes: "1, 4",
    });
    expect(graph["4"]?.inputs.text).toEqual(["21", 0]);
  });

  test("refuse une taille qui n'est pas un multiple de 16", () => {
    expect(() => buildMossImagePrompt({ ...options, width: 1000 })).toThrow("multiple de 16");
  });

  test("refuse une boîte de texte sans texte", () => {
    const bad: MossBox = { x: 0, y: 0, width: 16, height: 16, kind: MossBoxKind.Text, description: "a title" };
    expect(() => buildMossImagePrompt({ ...options, boxes: [bad] })).toThrow("boîte 1");
  });

  test("meta va dans le _meta de l'UNET", () => {
    const graph = buildMossImagePrompt(options, { preset: "moss" });
    expect(graph["1"]?._meta).toEqual({ preset: "moss" });
  });
});

describe("generateMossImage", () => {
  test("envoie le graphe avec les boîtes emballées et enregistre l'image", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moss-image-"));
    directories.push(directory);
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
            outputs: { "9": { images: [{ filename: "moss.png", subfolder: "", type: "output" }] } },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateMossImage({ ...options, boxes }, { server: "http://127.0.0.1:9", outputDir: directory });

    const body = JSON.parse(postedPrompt) as { prompt: Record<string, { inputs: Record<string, unknown> }> };
    expect((body.prompt["20"]?.inputs.editor_state as { __value__: unknown[] }).__value__).toHaveLength(4);
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});
