import { ASPECT_RATIOS, SAMPLER_NAMES, SCHEDULER_NAMES } from "./workflow.ts";
import { DEFAULT_SERVER } from "./client.ts";
import { QWEN_IMAGE_DEFAULTS, generateQwenImage, type QwenImageOptions } from "./models/qwen-image.ts";

const DEFAULT_PROMPT = "a young cat walking on a table, daylight";
const DEFAULT_NEGATIVE = "blur,bad quality";

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

async function main(): Promise<void> {
  const { server, options } = parseGenerateArgs(process.argv, process.env);
  const paths = await generateQwenImage(options, { server, logger: console });
  for (const path of paths) console.log(path);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
