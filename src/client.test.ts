import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { clearHistory, runGraph } from "./client.ts";
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

/** Serveur qui termine le prompt `abc` avec une image et accepte sa suppression. */
function fakeServer(calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/prompt")) return Response.json({ prompt_id: "abc" });
    if (url.endsWith("/history/abc")) {
      return Response.json({
        abc: {
          status: { completed: true, status_str: "success" },
          outputs: {
            "9": { images: [{ filename: "kettle.png", subfolder: "", type: "output" }] },
          },
        },
      });
    }
    if (url.startsWith("http://127.0.0.1:9/view?")) return new Response(new Uint8Array([1]));
    if ((url.endsWith("/history") || url.endsWith("/queue")) && init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ delete: ["abc"] });
      return new Response(null, { status: 200 });
    }
    throw new Error(`requête inattendue : ${url}`);
  }) as typeof fetch;
}

describe("runGraph", () => {
  test("retire l'image de l'historique et le prompt de la file", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "client-"));
    directories.push(outputDir);
    const calls: string[] = [];

    globalThis.fetch = fakeServer(calls);

    await runGraph(graph, {
      server: "http://127.0.0.1:9",
      outputDir,
      deleteFromServer: true,
    });

    const view = calls.findIndex((call) => call.startsWith("GET http://127.0.0.1:9/view?"));
    const history = calls.findIndex((call) => call === "POST http://127.0.0.1:9/history");
    const queue = calls.findIndex((call) => call === "POST http://127.0.0.1:9/queue");
    expect(view).toBeGreaterThan(-1);
    expect(history).toBeGreaterThan(view);
    expect(queue).toBeGreaterThan(history);
  });

  test("laisse l'historique en place sans deleteFromServer", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "client-"));
    directories.push(outputDir);
    const calls: string[] = [];

    globalThis.fetch = fakeServer(calls);

    await runGraph(graph, { server: "http://127.0.0.1:9", outputDir });
    expect(calls.some((call) => call.startsWith("POST "))).toBe(true);
    expect(calls.some((call) => call === "POST http://127.0.0.1:9/history")).toBe(false);
    expect(calls.some((call) => call === "POST http://127.0.0.1:9/queue")).toBe(false);
  });

  test("remonte le refus de ComfyUI", async () => {
    globalThis.fetch = async () => Response.json({ error: "bad graph" }, { status: 400 });

    await expect(runGraph(graph, { server: "http://127.0.0.1:9" })).rejects.toThrow(
      /a refusé le graphe \(400\)/,
    );
  });

  test("passe la progression au logger", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "client-"));
    directories.push(outputDir);
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
