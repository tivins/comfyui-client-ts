import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildQwenImagePrompt } from "./workflow.ts";

const DEFAULT_PROMPT = "a young cat walking on a table, daylight";
const DEFAULT_NEGATIVE = "blur,bad quality";
const DEFAULT_SERVER = "http://127.0.0.1:8188";
const POLL_MS = 2000;
const TIMEOUT_MS = 30 * 60 * 1000;

type HistoryImage = {
  filename: string;
  subfolder: string;
  type: string;
};

type HistoryEntry = {
  outputs?: Record<string, { images?: HistoryImage[] }>;
  status?: {
    completed?: boolean;
    status_str?: string;
    messages?: unknown[];
  };
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} attend une valeur`);
  }
  return value;
}

function serverBase(): string {
  return (flag("server") ?? process.env.COMFY_URL ?? DEFAULT_SERVER).replace(/\/$/, "");
}

async function queuePrompt(base: string, prompt: ReturnType<typeof buildQwenImagePrompt>): Promise<string> {
  const response = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`ComfyUI a refusé le graphe (${response.status}) : ${JSON.stringify(body)}`);
  }
  const promptId = body.prompt_id;
  if (typeof promptId !== "string") {
    throw new Error(`Réponse /prompt sans prompt_id : ${JSON.stringify(body)}`);
  }
  return promptId;
}

async function waitForHistory(base: string, promptId: string): Promise<HistoryEntry> {
  const started = Date.now();
  let lastLog = 0;
  while (Date.now() - started < TIMEOUT_MS) {
    const response = await fetch(`${base}/history/${promptId}`);
    if (!response.ok) {
      throw new Error(`GET /history/${promptId} a répondu ${response.status}`);
    }
    const history = (await response.json()) as Record<string, HistoryEntry>;
    const entry = history[promptId];
    if (entry?.status?.completed) {
      if (entry.status.status_str && entry.status.status_str !== "success") {
        throw new Error(`Génération en échec : ${JSON.stringify(entry.status)}`);
      }
      return entry;
    }
    const now = Date.now();
    if (now - lastLog >= 15_000) {
      const seconds = Math.round((now - started) / 1000);
      console.log(`en cours (${seconds}s)…`);
      lastLog = now;
    }
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Pas de résultat après ${TIMEOUT_MS / 1000}s (prompt_id ${promptId})`);
}

function collectImages(entry: HistoryEntry): HistoryImage[] {
  const images: HistoryImage[] = [];
  for (const output of Object.values(entry.outputs ?? {})) {
    for (const image of output.images ?? []) {
      images.push(image);
    }
  }
  return images;
}

async function downloadImage(base: string, image: HistoryImage, directory: string): Promise<string> {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const response = await fetch(`${base}/view?${query}`);
  if (!response.ok) {
    throw new Error(`GET /view ${image.filename} a répondu ${response.status}`);
  }
  const target = join(directory, image.filename);
  await Bun.write(target, await response.bytes());
  return target;
}

async function main(): Promise<void> {
  const prompt = flag("prompt") ?? process.env.PROMPT ?? DEFAULT_PROMPT;
  const negativePrompt = flag("negative") ?? process.env.NEGATIVE_PROMPT ?? DEFAULT_NEGATIVE;
  const base = serverBase();
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), "..", "output");

  const graph = buildQwenImagePrompt({ prompt, negativePrompt });
  console.log(`serveur ${base}`);
  console.log(`prompt : ${prompt}`);
  console.log(`négatif : ${negativePrompt}`);

  const promptId = await queuePrompt(base, graph);
  console.log(`en file : ${promptId}`);

  const entry = await waitForHistory(base, promptId);
  const images = collectImages(entry);
  if (images.length === 0) {
    throw new Error(`Aucune image dans l'historique de ${promptId}`);
  }

  await mkdir(outputDir, { recursive: true });
  for (const image of images) {
    const path = await downloadImage(base, image, outputDir);
    console.log(path);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
