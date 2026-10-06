import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, test } from "bun:test";

import { readPngMetadata, readPngMetadataFile } from "./png-metadata.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  return out;
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function keywordText(key: string, value: Uint8Array, compressed: boolean): Uint8Array {
  const keyBytes = latin1(key);
  const out = new Uint8Array(keyBytes.length + 1 + (compressed ? 1 : 0) + value.length);
  out.set(keyBytes, 0);
  let offset = keyBytes.length + 1;
  if (compressed) out[offset++] = 0;
  out.set(value, offset);
  return out;
}

const IHDR = chunk("IHDR", Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
const IEND = chunk("IEND", new Uint8Array());

function png(...chunks: Uint8Array[]): Uint8Array {
  return concat([PNG_SIGNATURE, IHDR, ...chunks, IEND]);
}

const prompt = { "4": { class_type: "SaveImage", inputs: { filename_prefix: "Krea2" } } };
const workflow = { nodes: [{ id: 4, type: "SaveImage" }], version: 0.4 };

describe("readPngMetadata", () => {
  test("lit prompt et workflow dans des chunks tEXt", () => {
    const bytes = png(
      chunk("tEXt", keywordText("prompt", latin1(JSON.stringify(prompt)), false)),
      chunk("tEXt", keywordText("workflow", latin1(JSON.stringify(workflow)), false)),
    );
    expect(readPngMetadata(bytes)).toEqual({ prompt, workflow });
  });

  test("laisse workflow à null quand seul prompt est présent", () => {
    const bytes = png(chunk("tEXt", keywordText("prompt", latin1(JSON.stringify(prompt)), false)));
    expect(readPngMetadata(bytes)).toEqual({ prompt, workflow: null });
  });

  test("ignore les autres mots-clés et garde le premier prompt", () => {
    const first = { seed: 1 };
    const bytes = png(
      chunk("tEXt", keywordText("Title", latin1("ignored"), false)),
      chunk("tEXt", keywordText("prompt", latin1(JSON.stringify(first)), false)),
      chunk("tEXt", keywordText("prompt", latin1(JSON.stringify({ seed: 2 })), false)),
    );
    expect(readPngMetadata(bytes).prompt).toEqual(first);
  });

  test("lit un zTXt compressé", () => {
    const bytes = png(
      chunk("zTXt", keywordText("workflow", deflateSync(latin1(JSON.stringify(workflow))), true)),
    );
    expect(readPngMetadata(bytes).workflow).toEqual(workflow);
  });

  test("lit un iTXt utf-8", () => {
    const text = JSON.stringify({ caption: "café" });
    const key = latin1("prompt");
    const value = new TextEncoder().encode(text);
    const data = new Uint8Array(key.length + 5 + value.length);
    data.set(key, 0);
    data.set(value, key.length + 5);
    expect(readPngMetadata(png(chunk("iTXt", data))).prompt).toEqual({ caption: "café" });
  });

  test("lit le chunk comf des PNG animés", () => {
    const bytes = png(chunk("comf", keywordText("prompt", latin1(JSON.stringify(prompt)), false)));
    expect(readPngMetadata(bytes).prompt).toEqual(prompt);
  });

  test("refuse un fichier qui n'est pas un PNG", () => {
    expect(() => readPngMetadata(Uint8Array.from([1, 2, 3]))).toThrow("Pas un PNG");
  });

  test("refuse un PNG tronqué", () => {
    expect(() => readPngMetadata(PNG_SIGNATURE)).toThrow("PNG tronqué");
  });

  test("refuse un JSON illisible", () => {
    const bytes = png(chunk("tEXt", keywordText("prompt", latin1("{"), false)));
    expect(() => readPngMetadata(bytes)).toThrow("JSON invalide dans le chunk prompt");
  });
});

describe("readPngMetadataFile", () => {
  test("lit un fichier PNG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "png-metadata-"));
    directories.push(directory);
    const path = join(directory, "image.png");
    const bytes = png(chunk("tEXt", keywordText("prompt", latin1(JSON.stringify(prompt)), false)));
    await Bun.write(path, bytes);
    expect(await readPngMetadataFile(path)).toEqual({ prompt, workflow: null });
  });

  test("signale un fichier absent", async () => {
    await expect(readPngMetadataFile("/tmp/comfyui-png-metadata-absent.png")).rejects.toThrow("introuvable");
  });
});
