import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import type { ApiPrompt } from "../workflow.ts";
import {
  buildMiniMaxMusic3Prompt,
  generateMiniMaxMusic3,
  MINIMAX_MUSIC3_DEFAULTS,
  type MiniMaxMusic3Options,
} from "./minimax-music3.ts";

const options: MiniMaxMusic3Options = {
  ...MINIMAX_MUSIC3_DEFAULTS,
  caption: "Global Metadata: Lo-fi hip-hop.",
  lyrics: "[Intro]\nMmm...",
};

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function withoutMeta(graph: ApiPrompt) {
  return Object.fromEntries(
    Object.entries(graph).map(([id, node]) => [id, { class_type: node.class_type, inputs: node.inputs }]),
  );
}

describe("buildMiniMaxMusic3Prompt", () => {
  test("reproduit le graphe exporté depuis l'interface", () => {
    const exported = JSON.parse(
      readFileSync(new URL("../../../docs/workflow_audio_minimax_music_3.json", import.meta.url), "utf8"),
    ) as ApiPrompt;
    const encode = exported["37:13"]!.inputs;

    const graph = buildMiniMaxMusic3Prompt({
      ...MINIMAX_MUSIC3_DEFAULTS,
      caption: encode.caption as string,
      lyrics: encode.lyrics as string,
      seed: 200477901624776,
    });

    expect(withoutMeta(graph)).toEqual(withoutMeta(exported));
  });

  test("place les textes, la graine, la durée et les réglages", () => {
    const graph = buildMiniMaxMusic3Prompt({
      ...options,
      seed: 7,
      maxDuration: 90,
      steps: 20,
      cfg: 2,
      cfgScale: 1.5,
      topK: 40,
    });

    expect(graph["37:13"]?.inputs.caption).toBe("Global Metadata: Lo-fi hip-hop.");
    expect(graph["37:13"]?.inputs.lyrics).toBe("[Intro]\nMmm...");
    expect(graph["37:13"]?.inputs.max_duration).toBe(90);
    expect(graph["37:13"]?.inputs.cfg_scale).toBe(1.5);
    expect(graph["37:13"]?.inputs.top_k).toBe(40);
    expect(graph["37:38"]?.inputs.seed).toBe(7);
    expect(graph["37:9"]?.inputs.steps).toBe(20);
    expect(graph["37:9"]?.inputs.cfg).toBe(2);
  });

  test("ajoute meta au _meta de l'UNET", () => {
    expect(buildMiniMaxMusic3Prompt(options)["37:6"]?._meta).toEqual({ title: "Charger Modèle Diffusion" });
    expect(buildMiniMaxMusic3Prompt(options, { run: "a" })["37:6"]?._meta).toEqual({
      title: "Charger Modèle Diffusion",
      run: "a",
    });
  });
});

describe("generateMiniMaxMusic3", () => {
  test("envoie le graphe avec settings.meta et écrit le mp3 rangé sous audio", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "minimax-"));
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
              "35": { audio: [{ filename: "song.mp3", subfolder: "audio", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith("http://127.0.0.1:9/view?")) {
        expect(new URL(url).searchParams.get("subfolder")).toBe("audio");
        return new Response(new Uint8Array([6, 7]));
      }
      throw new Error(`requête inattendue : ${url}`);
    };

    const paths = await generateMiniMaxMusic3(options, {
      server: "http://127.0.0.1:9",
      outputDir,
      meta: { run: "a" },
    });

    const graph = JSON.parse(postedPrompt) as {
      prompt: Record<string, { inputs: { caption?: string }; _meta: Record<string, unknown> }>;
    };
    expect(graph.prompt["37:13"]?.inputs.caption).toBe("Global Metadata: Lo-fi hip-hop.");
    expect(graph.prompt["37:6"]?._meta.run).toBe("a");
    expect(paths[0]).toEndWith("-song.mp3");
    expect(await Bun.file(paths[0]!).bytes()).toEqual(new Uint8Array([6, 7]));
  });
});
