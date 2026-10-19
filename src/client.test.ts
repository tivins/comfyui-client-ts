import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { clearHistory, runGraph } from "./client.ts";
import { silentLogger } from "./logger.ts";
import type { ApiPrompt } from "./workflow.ts";

const graph: ApiPrompt = {
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "test" }, _meta: {} },
};

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

type FakeFile = { filename: string; subfolder: string; type: string };

const kettle: FakeFile = { filename: "kettle.png", subfolder: "", type: "output" };

type FakeServerOptions = {
  calls?: string[];
  files?: FakeFile[];
  /** Statut de `POST /api/output/delete` ; 405 imite un ComfyUI sans le custom node. */
  outputDeleteStatus?: number;
  outputDeleteBodies?: unknown[];
  /** Le nœud de sortie `9` est annoncé dans `execution_cached`, comme pour un graphe identique déjà lancé. */
  cached?: boolean;
  viewStatus?: number;
};

/** Serveur qui termine le prompt `abc` avec `files` (une image par défaut) et accepte leur suppression. */
function fakeServer({
  calls = [],
  files = [kettle],
  outputDeleteStatus = 200,
  outputDeleteBodies = [],
  cached = false,
  viewStatus = 200,
}: FakeServerOptions = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/prompt")) return Response.json({ prompt_id: "abc" });
    if (url.endsWith("/history/abc")) {
      return Response.json({
        abc: {
          status: {
            completed: true,
            status_str: "success",
            messages: cached ? [["execution_cached", { nodes: ["9"], prompt_id: "abc" }]] : [],
          },
          outputs: { "9": { images: files } },
        },
      });
    }
    if (url.startsWith("http://127.0.0.1:9/view?")) {
      return viewStatus === 200 ? new Response(new Uint8Array([1])) : new Response(null, { status: viewStatus });
    }
    if (url.endsWith("/api/output/delete") && init?.method === "POST") {
      outputDeleteBodies.push(JSON.parse(String(init.body)));
      return Response.json({ deleted: [], missing: [] }, { status: outputDeleteStatus });
    }
    if ((url.endsWith("/history") || url.endsWith("/queue")) && init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ delete: ["abc"] });
      return new Response(null, { status: 200 });
    }
    throw new Error(`requête inattendue : ${url}`);
  }) as typeof fetch;
}

async function tempOutputDir(): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), "client-"));
  directories.push(outputDir);
  return outputDir;
}

describe("runGraph", () => {
  test("efface les fichiers du serveur, puis retire le prompt de l'historique et de la file", async () => {
    const calls: string[] = [];
    const outputDeleteBodies: unknown[] = [];
    globalThis.fetch = fakeServer({ calls, outputDeleteBodies });

    await runGraph(graph, {
      server: "http://127.0.0.1:9",
      outputDir: await tempOutputDir(),
      deleteFromServer: true,
    });

    const view = calls.findIndex((call) => call.startsWith("GET http://127.0.0.1:9/view?"));
    const files = calls.findIndex((call) => call === "POST http://127.0.0.1:9/api/output/delete");
    const history = calls.findIndex((call) => call === "POST http://127.0.0.1:9/history");
    const queue = calls.findIndex((call) => call === "POST http://127.0.0.1:9/queue");
    expect(view).toBeGreaterThan(-1);
    expect(files).toBeGreaterThan(view);
    expect(history).toBeGreaterThan(files);
    expect(queue).toBeGreaterThan(history);
    expect(outputDeleteBodies).toEqual([{ files: [kettle] }]);
  });

  test("n'envoie à l'effacement que les fichiers de type output", async () => {
    const preview: FakeFile = { filename: "preview.png", subfolder: "", type: "temp" };
    const song: FakeFile = { filename: "song.mp3", subfolder: "audio", type: "output" };
    const outputDeleteBodies: unknown[] = [];
    globalThis.fetch = fakeServer({ files: [preview, song], outputDeleteBodies });

    const paths = await runGraph(graph, {
      server: "http://127.0.0.1:9",
      outputDir: await tempOutputDir(),
      deleteFromServer: true,
    });

    expect(paths).toHaveLength(2);
    expect(outputDeleteBodies).toEqual([{ files: [song] }]);
  });

  test("sans fichier de type output, n'appelle pas la route d'effacement", async () => {
    const calls: string[] = [];
    const preview: FakeFile = { filename: "preview.png", subfolder: "", type: "temp" };
    globalThis.fetch = fakeServer({ calls, files: [preview] });

    await runGraph(graph, { server: "http://127.0.0.1:9", outputDir: await tempOutputDir(), deleteFromServer: true });

    expect(calls).not.toContain("POST http://127.0.0.1:9/api/output/delete");
    expect(calls).toContain("POST http://127.0.0.1:9/history");
  });

  for (const status of [404, 405]) {
    test(`sans le custom node (${status}), avertit et retire quand même l'historique`, async () => {
      const calls: string[] = [];
      const warnings: string[] = [];
      globalThis.fetch = fakeServer({ calls, outputDeleteStatus: status });

      const paths = await runGraph(graph, {
        server: "http://127.0.0.1:9",
        outputDir: await tempOutputDir(),
        deleteFromServer: true,
        logger: { ...silentLogger, warn: (message: string) => void warnings.push(message) },
      });

      expect(paths).toHaveLength(1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("comfyui-delete-output");
      expect(calls).toContain("POST http://127.0.0.1:9/history");
      expect(calls).toContain("POST http://127.0.0.1:9/queue");
    });
  }

  test("remonte un échec de l'effacement des fichiers", async () => {
    const calls: string[] = [];
    globalThis.fetch = fakeServer({ calls, outputDeleteStatus: 400 });

    await expect(
      runGraph(graph, { server: "http://127.0.0.1:9", outputDir: await tempOutputDir(), deleteFromServer: true }),
    ).rejects.toThrow(/POST \/api\/output\/delete a répondu 400/);
    expect(calls).not.toContain("POST http://127.0.0.1:9/history");
  });

  test("explique un fichier absent quand ComfyUI a repris le résultat du cache", async () => {
    globalThis.fetch = fakeServer({ cached: true, viewStatus: 404 });

    await expect(runGraph(graph, { server: "http://127.0.0.1:9", outputDir: await tempOutputDir() })).rejects.toThrow(
      /GET \/view kettle\.png a répondu 404\. ComfyUI a repris du cache/,
    );
  });

  test("garde le message court pour un 404 hors cache", async () => {
    globalThis.fetch = fakeServer({ viewStatus: 404 });

    await expect(runGraph(graph, { server: "http://127.0.0.1:9", outputDir: await tempOutputDir() })).rejects.toThrow(
      /^GET \/view kettle\.png a répondu 404$/,
    );
  });

  test("laisse les fichiers et l'historique en place sans deleteFromServer", async () => {
    const calls: string[] = [];
    globalThis.fetch = fakeServer({ calls });

    await runGraph(graph, { server: "http://127.0.0.1:9", outputDir: await tempOutputDir() });
    expect(calls.some((call) => call.startsWith("POST "))).toBe(true);
    expect(calls).not.toContain("POST http://127.0.0.1:9/api/output/delete");
    expect(calls).not.toContain("POST http://127.0.0.1:9/history");
    expect(calls).not.toContain("POST http://127.0.0.1:9/queue");
  });

  test("remonte le refus de ComfyUI", async () => {
    globalThis.fetch = async () => Response.json({ error: "bad graph" }, { status: 400 });

    await expect(runGraph(graph, { server: "http://127.0.0.1:9" })).rejects.toThrow(
      /a refusé le graphe \(400\)/,
    );
  });

  test("passe la progression au logger", async () => {
    const outputDir = await tempOutputDir();
    globalThis.fetch = fakeServer();
    const messages: string[] = [];
    const record = (message: string) => {
      messages.push(message);
    };

    const paths = await runGraph(graph, {
      server: "http://127.0.0.1:9",
      outputDir,
      logger: { debug: record, log: record, warn: record, error: record },
    });

    expect(messages).toEqual(["[comfyui] en file", "[comfyui] terminé (0s)", "[comfyui] enregistré"]);
    expect(paths).toHaveLength(1);
  });
});

describe("clearHistory", () => {
  test("vide l'historique ComfyUI", async () => {
    let body = "";
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:9/history");
      expect(init?.method).toBe("POST");
      body = String(init?.body);
      return new Response(null, { status: 200 });
    };

    await clearHistory("http://127.0.0.1:9/");
    expect(JSON.parse(body)).toEqual({ clear: true });
  });

  test("remonte le refus du serveur", async () => {
    globalThis.fetch = async () => new Response(null, { status: 500 });
    await expect(clearHistory("http://127.0.0.1:9")).rejects.toThrow(/POST \/history \(clear\) a répondu 500/);
  });
});
