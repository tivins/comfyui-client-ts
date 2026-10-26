import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";

import { runGraph } from "./client.ts";
import type { Logger } from "./logger.ts";
import type { GenerationProgress } from "./progress.ts";
import type { ApiPrompt } from "./workflow.ts";

const graph: ApiPrompt = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: {}, _meta: {} },
  "3": { class_type: "KSampler", inputs: {}, _meta: {} },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "test" }, _meta: {} },
};

const servers: Server<unknown>[] = [];
const directories: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const server of servers.splice(0)) server.stop(true);
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempOutputDir(): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), "progress-"));
  directories.push(outputDir);
  return outputDir;
}

type Sent = object | Uint8Array;

/**
 * ComfyUI factice, HTTP et WebSocket : `before` part sur le WebSocket avant la réponse de
 * `POST /prompt`, `after` juste après ; l'historique n'est complet qu'une fois `after` envoyé
 * (tout de suite si `after` est vide).
 */
function comfyServer(before: Sent[], after: Sent[]) {
  const seen = { clientIds: [] as string[], promptClientIds: [] as unknown[] };
  const sockets = new Map<string, ServerWebSocket<{ clientId: string }>>();
  let complete = false;
  const send = (socket: ServerWebSocket<{ clientId: string }> | undefined, messages: Sent[]) => {
    for (const message of messages) {
      socket?.send(message instanceof Uint8Array ? message : JSON.stringify(message));
    }
  };
  const server = Bun.serve<{ clientId: string }>({
    port: 0,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/ws") {
        const clientId = url.searchParams.get("clientId") ?? "";
        seen.clientIds.push(clientId);
        return server.upgrade(request, { data: { clientId } }) ? undefined : new Response(null, { status: 400 });
      }
      if (url.pathname === "/prompt") {
        const body = (await request.json()) as { client_id?: string };
        seen.promptClientIds.push(body.client_id);
        const socket = sockets.get(String(body.client_id));
        send(socket, before);
        complete = after.length === 0;
        setTimeout(() => {
          send(socket, after);
          complete = true;
        }, 20);
        return Response.json({ prompt_id: "abc" });
      }
      if (url.pathname === "/history/abc") {
        if (!complete) return Response.json({});
        return Response.json({
          abc: {
            status: { completed: true, status_str: "success", messages: [] },
            outputs: { "9": { images: [{ filename: "kettle.png", subfolder: "", type: "output" }] } },
          },
        });
      }
      if (url.pathname === "/view") return new Response(new Uint8Array([1]));
      return new Response(null, { status: 404 });
    },
    websocket: {
      open(socket) {
        sockets.set(socket.data.clientId, socket);
      },
      message() {},
    },
  });
  servers.push(server as Server<unknown>);
  return { base: `http://127.0.0.1:${server.port}`, seen };
}

function recordingLogger(warnings: string[]): Logger {
  return { debug() {}, log() {}, warn: (message) => warnings.push(message), error() {} };
}

describe("onProgress", () => {
  test("suit les nœuds et les pas du prompt, même reçus avant son prompt_id", async () => {
    const { base, seen } = comfyServer(
      [
        { type: "status", data: { status: { exec_info: { queue_remaining: 1 } } } },
        { type: "execution_start", data: { prompt_id: "abc" } },
        { type: "execution_cached", data: { nodes: ["1"], prompt_id: "abc" } },
        { type: "executing", data: { node: "3", prompt_id: "abc" } },
      ],
      [
        { type: "progress", data: { value: 1, max: 2, node: "3", prompt_id: "abc" } },
        new Uint8Array([0, 0, 0, 1, 0xff]),
        { type: "progress", data: { value: 5, max: 9, node: "7", prompt_id: "autre" } },
        { type: "progress", data: { value: 2, max: 2, node: "3", prompt_id: "abc" } },
        { type: "executing", data: { node: "9", prompt_id: "abc" } },
        { type: "executing", data: { node: null, prompt_id: "abc" } },
      ],
    );
    const events: GenerationProgress[] = [];

    const paths = await runGraph(graph, {
      server: base,
      outputDir: await tempOutputDir(),
      onProgress: (progress) => events.push(progress),
    });

    expect(paths).toHaveLength(1);
    expect(seen.promptClientIds).toEqual(seen.clientIds);
    const common = { promptId: "abc", nodesTotal: 2 };
    expect(events).toEqual([
      { ...common, node: "3", classType: "KSampler", nodesDone: 0, step: null },
      { ...common, node: "3", classType: "KSampler", nodesDone: 0, step: { value: 1, max: 2 } },
      { ...common, node: "3", classType: "KSampler", nodesDone: 0, step: { value: 2, max: 2 } },
      { ...common, node: "9", classType: "SaveImage", nodesDone: 1, step: null },
    ]);
  });

  test("une erreur du callback est signalée sans arrêter la génération", async () => {
    const { base } = comfyServer(
      [],
      [
        { type: "executing", data: { node: "3", prompt_id: "abc" } },
        { type: "executing", data: { node: null, prompt_id: "abc" } },
      ],
    );
    const warnings: string[] = [];

    const paths = await runGraph(graph, {
      server: base,
      outputDir: await tempOutputDir(),
      logger: recordingLogger(warnings),
      onProgress: () => {
        throw new Error("boum");
      },
    });

    expect(paths).toHaveLength(1);
    expect(warnings).toEqual(["[comfyui] onProgress a levé une erreur : Error: boum"]);
  });

  test("sans WebSocket, génère quand même et le signale", async () => {
    const { base } = comfyServer([], []);
    const http = base.replace(/\/$/, "");
    // Le WebSocket vise un port fermé ; le HTTP est relayé vers le serveur factice.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      originalFetch(String(input).replace("http://127.0.0.1:9", http), init)) as typeof fetch;
    const warnings: string[] = [];
    const events: GenerationProgress[] = [];

    const paths = await runGraph(graph, {
      server: "http://127.0.0.1:9",
      outputDir: await tempOutputDir(),
      logger: recordingLogger(warnings),
      onProgress: (progress) => events.push(progress),
    });

    expect(paths).toHaveLength(1);
    expect(events).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("injoignable");
  });
});
