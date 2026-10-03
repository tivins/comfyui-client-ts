import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { generateKrea2 } from "./krea2.ts";
import { KREA2_DEFAULTS, type Krea2Options } from "./workflow.ts";

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
