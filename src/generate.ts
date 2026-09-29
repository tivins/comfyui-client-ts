import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ASPECT_RATIOS,
  QWEN_IMAGE_DEFAULTS,
  SAMPLER_NAMES,
  SCHEDULER_NAMES,
  buildQwenImagePrompt,
  type QwenImageOptions,
} from "./workflow.ts";

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

function readFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} attend une valeur`);
  }
  return value;
}

function choiceFlag<T extends string>(
  argv: readonly string[],
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = readFlag(argv, name);
  if (raw === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`--${name} inconnu : ${raw}. Valeurs : ${allowed.join(", ")}`);
  }
  return raw as T;
}

function intFlag(argv: readonly string[], name: string, fallback: number, min: number): number {
  const raw = readFlag(argv, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${name} doit être un entier >= ${min}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`--${name} doit être un entier >= ${min}`);
  }
  return value;
}

export function parseGenerateArgs(
  argv: readonly string[],
  env: { PROMPT?: string; NEGATIVE_PROMPT?: string; COMFY_URL?: string } = {},
): { server: string; options: QwenImageOptions } {
  return {
    server: (readFlag(argv, "server") ?? env.COMFY_URL ?? DEFAULT_SERVER).replace(/\/$/, ""),
    options: {
      prompt: readFlag(argv, "prompt") ?? env.PROMPT ?? DEFAULT_PROMPT,
      negativePrompt: readFlag(argv, "negative") ?? env.NEGATIVE_PROMPT ?? DEFAULT_NEGATIVE,
      unetName: readFlag(argv, "unet") ?? QWEN_IMAGE_DEFAULTS.unetName,
      aspectRatio: choiceFlag(argv, "aspect", ASPECT_RATIOS, QWEN_IMAGE_DEFAULTS.aspectRatio),
      samplerName: choiceFlag(argv, "sampler", SAMPLER_NAMES, QWEN_IMAGE_DEFAULTS.samplerName),
      seed: intFlag(argv, "seed", QWEN_IMAGE_DEFAULTS.seed, 0),
      steps: intFlag(argv, "steps", QWEN_IMAGE_DEFAULTS.steps, 1),
      scheduler: choiceFlag(argv, "scheduler", SCHEDULER_NAMES, QWEN_IMAGE_DEFAULTS.scheduler),
    },
  };
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
  const { server: base, options } = parseGenerateArgs(process.argv, process.env);
  const outputDir = join(dirname(fileURLToPath(import.meta.url)), "..", "output");

  const graph = buildQwenImagePrompt(options);
  console.log(`serveur ${base}`);
  console.log(`prompt : ${options.prompt}`);
  console.log(`négatif : ${options.negativePrompt}`);
  console.log(`unet : ${options.unetName}`);
  console.log(`ratio : ${options.aspectRatio}`);
  console.log(
    `sampler : ${options.samplerName} / ${options.scheduler}, seed ${options.seed}, ${options.steps} steps`,
  );

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
