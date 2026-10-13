import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { generateKrea2, generateKrea2Edit } from "./krea2.ts";
import { KREA2_DEFAULTS, KREA2_EDIT_DEFAULTS, type Krea2Options } from "./workflow.ts";

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

    globalThis.fetch = async (input, init) => {
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
    };

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

    globalThis.fetch = async (input, init) => {
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
    };

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
