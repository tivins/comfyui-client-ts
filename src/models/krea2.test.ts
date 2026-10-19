import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import type { ApiPrompt } from "../workflow.ts";
import {
  KREA2_DEFAULTS,
  KREA2_EDIT_DEFAULTS,
  buildKrea2EditPrompt,
  buildKrea2Prompt,
  generateKrea2,
  generateKrea2Edit,
  type Krea2EditOptions,
  type Krea2Options,
} from "./krea2.ts";

const options: Krea2Options = {
  prompt: "a red kettle",
  negativePrompt: "",
  unetName: KREA2_DEFAULTS.unetName,
  width: KREA2_DEFAULTS.width,
  height: KREA2_DEFAULTS.height,
  samplerName: KREA2_DEFAULTS.samplerName,
  seed: KREA2_DEFAULTS.seed,
  steps: KREA2_DEFAULTS.steps,
  cfg: KREA2_DEFAULTS.cfg,
  scheduler: KREA2_DEFAULTS.scheduler,
  loras: [],
  batchSize: KREA2_DEFAULTS.batchSize,
};

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("generateKrea2", () => {
  test("envoie le graphe Krea 2 et écrit l'image", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "krea2-"));
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
              "4": { images: [{ filename: "kettle.png", subfolder: "", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateKrea2(options, {
      server: "http://127.0.0.1:9",
      outputDir,
    });

    const graph = JSON.parse(postedPrompt) as {
      prompt: Record<string, { class_type?: string; inputs: { text?: string; type?: string; cfg?: number } }>;
    };
    expect(graph.prompt["8"]?.inputs.text).toBe("a red kettle");
    expect(graph.prompt["7"]?.inputs.type).toBe("krea2");
    expect(graph.prompt["2"]?.inputs.cfg).toBe(1.5);
    expect(paths[0]).toStartWith(outputDir);
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("generateKrea2Edit", () => {
  test("envoie la référence, puis le graphe qui la charge", async () => {
    const directory = await mkdtemp(join(tmpdir(), "krea2-edit-"));
    directories.push(directory);
    const reference = join(directory, "ref.png");
    await writeFile(reference, new Uint8Array([9]));
    const calls: string[] = [];
    let postedPrompt = "";

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(url.replace("http://127.0.0.1:9", ""));
      if (url.endsWith("/upload/image")) {
        return Response.json({ name: "ref (1).png", subfolder: "", type: "input" });
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
              "29": { images: [{ filename: "edit.png", subfolder: "", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        return new Response(new Uint8Array([1, 2, 3]));
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;

    const paths = await generateKrea2Edit(
      {
        ...options,
        referenceImage: reference,
        editLora: KREA2_EDIT_DEFAULTS.editLora,
        refBoost: KREA2_EDIT_DEFAULTS.refBoost,
        groundingPx: KREA2_EDIT_DEFAULTS.groundingPx,
        fitMode: KREA2_EDIT_DEFAULTS.fitMode,
      },
      { server: "http://127.0.0.1:9", outputDir: directory },
    );

    expect(calls.slice(0, 2)).toEqual(["/upload/image", "/prompt"]);
    const graph = JSON.parse(postedPrompt) as {
      prompt: Record<string, { inputs: { image?: string; prompt?: string } }>;
    };
    expect(graph.prompt["72"]?.inputs.image).toBe("ref (1).png");
    expect(graph.prompt["84"]?.inputs.prompt).toBe("a red kettle");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([1, 2, 3]));
  });
});

const kreaOptions: Krea2Options = {
  prompt: "a red kettle",
  negativePrompt: "blur",
  unetName: KREA2_DEFAULTS.unetName,
  width: KREA2_DEFAULTS.width,
  height: KREA2_DEFAULTS.height,
  samplerName: KREA2_DEFAULTS.samplerName,
  seed: KREA2_DEFAULTS.seed,
  steps: KREA2_DEFAULTS.steps,
  cfg: KREA2_DEFAULTS.cfg,
  scheduler: KREA2_DEFAULTS.scheduler,
  loras: [],
  batchSize: KREA2_DEFAULTS.batchSize,
};

describe("buildKrea2Prompt", () => {
  test("place le prompt et le négatif sur deux CLIPTextEncode", () => {
    const graph = buildKrea2Prompt(kreaOptions);

    expect(graph["8"]?.class_type).toBe("CLIPTextEncode");
    expect(graph["8"]?.inputs.text).toBe("a red kettle");
    expect(graph["8"]?.inputs.clip).toEqual(["7", 0]);
    expect(graph["9"]?.inputs.text).toBe("blur");
    expect(graph["9"]?.inputs.clip).toEqual(["7", 0]);
    expect(graph["7"]?.inputs.type).toBe("krea2");
    expect(graph["7"]?.inputs.clip_name).toBe("qwen3vl_4b_fp8_scaled.safetensors");
  });

  test("reprend le modèle, la taille et le sampler de l'exemple", () => {
    const graph = buildKrea2Prompt({
      ...kreaOptions,
      unetName: "other.safetensors",
      width: 768,
      height: 1024,
      samplerName: "dpmpp_2m",
      seed: 7,
      steps: 20,
      cfg: 2,
      scheduler: "beta",
    });

    expect(graph["1"]?.inputs.unet_name).toBe("other.safetensors");
    expect(graph["1"]?.inputs.weight_dtype).toBe("default");
    expect(graph["5"]?.inputs.vae_name).toBe("qwen_image_vae.safetensors");
    expect(graph["11"]?.inputs.width).toBe(768);
    expect(graph["11"]?.inputs.height).toBe(1024);
    expect(graph["11"]?.inputs.batch_size).toBe(1);
    expect(graph["2"]?.inputs.model).toEqual(["1", 0]);
    expect(graph["2"]?.inputs.positive).toEqual(["8", 0]);
    expect(graph["2"]?.inputs.negative).toEqual(["9", 0]);
    expect(graph["2"]?.inputs.latent_image).toEqual(["11", 0]);
    expect(graph["2"]?.inputs.sampler_name).toBe("dpmpp_2m");
    expect(graph["2"]?.inputs.seed).toBe(7);
    expect(graph["2"]?.inputs.steps).toBe(20);
    expect(graph["2"]?.inputs.cfg).toBe(2);
    expect(graph["2"]?.inputs.scheduler).toBe("beta");
    expect(graph["2"]?.inputs.denoise).toBe(1);
    expect(graph["3"]?.inputs.samples).toEqual(["2", 0]);
    expect(graph["3"]?.inputs.vae).toEqual(["5", 0]);
    expect(graph["4"]?.inputs.images).toEqual(["3", 0]);
    expect(graph["4"]?.inputs.filename_prefix).toBe("Krea2");
  });

  test("garde les défauts du workflow krea2_safetensor", () => {
    const graph = buildKrea2Prompt(kreaOptions);

    expect(graph["1"]?.inputs.unet_name).toBe("museByStableYogi_v35Int8Extended.safetensors");
    expect(graph["11"]?.inputs.width).toBe(960);
    expect(graph["11"]?.inputs.height).toBe(1472);
    expect(graph["2"]?.inputs.seed).toBe(42);
    expect(graph["2"]?.inputs.steps).toBe(16);
    expect(graph["2"]?.inputs.cfg).toBe(1.5);
    expect(graph["2"]?.inputs.sampler_name).toBe("euler");
    expect(graph["2"]?.inputs.scheduler).toBe("simple");
    expect(graph["2"]?.inputs).not.toHaveProperty("control_after_generate");
  });

  test("chaîne les LoRA entre l'UNET et le KSampler", () => {
    const graph = buildKrea2Prompt({
      ...kreaOptions,
      loras: [
        { model: "a.safetensors", weight: 0.8 },
        { model: "b.safetensors", weight: 0.5 },
      ],
    });

    expect(graph["12"]?.class_type).toBe("LoraLoaderModelOnly");
    expect(graph["12"]?.inputs).toEqual({ lora_name: "a.safetensors", strength_model: 0.8, model: ["1", 0] });
    expect(graph["13"]?.inputs).toEqual({ lora_name: "b.safetensors", strength_model: 0.5, model: ["12", 0] });
    expect(graph["2"]?.inputs.model).toEqual(["13", 0]);
  });
});

const editOptions: Krea2EditOptions = {
  ...kreaOptions,
  negativePrompt: "",
  referenceImage: "ref.png",
  editLora: KREA2_EDIT_DEFAULTS.editLora,
  refBoost: KREA2_EDIT_DEFAULTS.refBoost,
  groundingPx: KREA2_EDIT_DEFAULTS.groundingPx,
  fitMode: KREA2_EDIT_DEFAULTS.fitMode,
};

/** Garde `class_type` et `inputs`, comme le graphe envoyé par l'interface. */
function withoutMeta(graph: ApiPrompt) {
  return Object.fromEntries(
    Object.entries(graph).map(([id, node]) => [id, { class_type: node.class_type, inputs: node.inputs }]),
  );
}

describe("buildKrea2EditPrompt", () => {
  test("reproduit le graphe exporté depuis l'interface", () => {
    const exported = JSON.parse(
      readFileSync(new URL("../../../docs/workflow_krea2_identity_edit_mei_laughing.json", import.meta.url), "utf8"),
    ) as ApiPrompt;
    // L'interface passe par un ResolutionSelector (2:3, 0.5 Mpx) ; le client donne la taille.
    delete exported["83"];
    exported["82"]!.inputs.width = 592;
    exported["82"]!.inputs.height = 888;
    exported["29"]!.inputs.filename_prefix = "Krea2Edit";

    const graph = buildKrea2EditPrompt({
      ...editOptions,
      prompt: "a photo of this person laughing",
      referenceImage: "v3_seed256.png",
      width: 592,
      height: 888,
      seed: 1033870496364480,
    });

    expect(withoutMeta(graph)).toEqual(withoutMeta(exported));
  });

  test("place les réglages de la référence", () => {
    const graph = buildKrea2EditPrompt({
      ...editOptions,
      negativePrompt: "blur",
      refBoost: 2.5,
      groundingPx: 1024,
      fitMode: "crop (legacy)",
      editLora: { model: "edit.safetensors", weight: 0.9 },
    });

    expect(graph["72"]?.inputs.image).toBe("ref.png");
    expect(graph["79"]?.inputs.ref_boost).toBe(2.5);
    expect(graph["79"]?.inputs.fit_mode).toBe("crop (legacy)");
    expect(graph["84"]?.inputs.grounding_px).toBe(1024);
    expect(graph["85"]?.inputs.grounding_px).toBe(1024);
    expect(graph["85"]?.inputs.prompt).toBe("blur");
    expect(graph["71"]?.inputs.lora_name).toBe("edit.safetensors");
    expect(graph["71"]?.inputs.strength_model).toBe(0.9);
  });

  test("ajoute les autres LoRA après la LoRA d'édition, avant le patch", () => {
    const graph = buildKrea2EditPrompt({
      ...editOptions,
      loras: [{ model: "style.safetensors", weight: 0.6 }],
    });

    expect(graph["71"]?.inputs.model).toEqual(["55", 0]);
    expect(graph["86"]?.inputs).toEqual({ lora_name: "style.safetensors", strength_model: 0.6, model: ["71", 0] });
    expect(graph["79"]?.inputs.model).toEqual(["86", 0]);
    expect(graph["53"]?.inputs.model).toEqual(["79", 0]);
  });

  test("garde les défauts retenus lors des essais dans l'interface", () => {
    const graph = buildKrea2EditPrompt(editOptions, { title: "run" });

    expect(graph["55"]?._meta).toEqual({ title: "run" });
    expect(graph["71"]?.inputs.lora_name).toBe("krea2_identity_edit_v1_2_r128.safetensors");
    expect(graph["79"]?.inputs.ref_boost).toBe(4);
    expect(graph["84"]?.inputs.grounding_px).toBe(768);
    expect(graph["82"]?.inputs.width).toBe(960);
    expect(graph["82"]?.inputs.height).toBe(1472);
    expect(graph["53"]?.inputs.steps).toBe(16);
    expect(graph["53"]?.inputs.cfg).toBe(1.5);
  });
});
