import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { readMp3Metadata, readMp3MetadataFile } from "./mp3-metadata.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function synchsafe(value: number): Uint8Array {
  return Uint8Array.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f]);
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index++) {
    out[index * 2] = text.charCodeAt(index) & 0xff;
    out[index * 2 + 1] = text.charCodeAt(index) >> 8;
  }
  return out;
}

/** Données d'une frame `TXXX` : 0 latin-1, 1 UTF-16 avec BOM, 3 UTF-8. */
function txxx(key: string, value: string, encoding: 0 | 1 | 3 = 3): Uint8Array {
  if (encoding === 1) {
    const bom = Uint8Array.from([0xff, 0xfe]);
    return concat([Uint8Array.from([1]), bom, utf16le(key), Uint8Array.from([0, 0]), bom, utf16le(value)]);
  }
  const encode = encoding === 0 ? latin1 : ascii;
  return concat([Uint8Array.from([encoding]), encode(key), Uint8Array.from([0]), encode(value)]);
}

function frame(version: 3 | 4, id: string, data: Uint8Array, formatFlags = 0): Uint8Array {
  const size = version === 4 ? synchsafe(data.length) : uint32(data.length);
  return concat([ascii(id), size, Uint8Array.from([0, formatFlags]), data]);
}

function id3(version: 3 | 4, body: Uint8Array, flags = 0, padding = 0): Uint8Array {
  const tag = concat([body, new Uint8Array(padding)]);
  return concat([ascii("ID3"), Uint8Array.from([version, 0, flags]), synchsafe(tag.length), tag]);
}

/** Ajoute un 00 derrière chaque FF. */
function unsync(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (const byte of bytes) {
    out.push(byte);
    if (byte === 0xff) out.push(0);
  }
  return Uint8Array.from(out);
}

/** Début d'une frame audio MPEG-1 Layer III. */
const AUDIO = Uint8Array.from([0xff, 0xfb, 0x90, 0x00]);

const prompt = { "35": { class_type: "SaveAudioAdvanced", inputs: { format: "mp3" }, _meta: { title: "Enregistrer l’Audio" } } };
const workflow = { nodes: [{ id: 35, type: "SaveAudioAdvanced" }], version: 0.4 };

describe("readMp3Metadata", () => {
  test("lit prompt et workflow d'un tag ID3v2.4 en UTF-8, comme ComfyUI les écrit", () => {
    const bytes = concat([
      id3(4, concat([
        frame(4, "TXXX", txxx("prompt", JSON.stringify(prompt))),
        frame(4, "TXXX", txxx("workflow", JSON.stringify(workflow))),
        frame(4, "TSSE", concat([Uint8Array.from([3]), ascii("Lavf62.12.102")])),
      ]), 0, 64),
      AUDIO,
    ]);
    expect(readMp3Metadata(bytes)).toEqual({ prompt, workflow });
  });

  test("lit un tag ID3v2.3 en UTF-16 et en latin-1", () => {
    const bytes = id3(3, concat([
      frame(3, "TXXX", txxx("prompt", JSON.stringify(prompt), 1)),
      frame(3, "TXXX", txxx("workflow", JSON.stringify(workflow), 0)),
    ]));
    expect(readMp3Metadata(bytes)).toEqual({ prompt, workflow });
  });

  test("ignore les autres descriptions et garde le premier tag de chaque clé", () => {
    const bytes = id3(4, concat([
      frame(4, "TXXX", txxx("comment", "{")),
      frame(4, "TXXX", txxx("prompt", JSON.stringify(prompt))),
      frame(4, "TXXX", txxx("prompt", JSON.stringify({ autre: true }))),
    ]));
    expect(readMp3Metadata(bytes)).toEqual({ prompt, workflow: null });
  });

  test("retire le NUL final d'une valeur", () => {
    const bytes = id3(4, frame(4, "TXXX", concat([txxx("prompt", JSON.stringify(prompt)), Uint8Array.from([0])])));
    expect(readMp3Metadata(bytes).prompt).toEqual(prompt);
  });

  test("ID3v2.4 : gère l'en-tête étendu, l'indicateur de longueur et la désynchronisation de frame", () => {
    // En latin-1, « ÿ » vaut FF : la désynchronisation ajoute un 00 derrière.
    const data = txxx("prompt", JSON.stringify({ texte: "ÿ" }), 0);
    const unsynced = unsync(data);
    expect(unsynced.length).toBe(data.length + 1);
    const extended = concat([synchsafe(6), Uint8Array.from([1, 0])]);
    const body = concat([extended, frame(4, "TXXX", concat([synchsafe(data.length), unsynced]), 0x03)]);
    expect(readMp3Metadata(id3(4, body, 0x40))).toEqual({ prompt: { texte: "ÿ" }, workflow: null });
  });

  test("ID3v2.3 : gère la désynchronisation de tout le tag", () => {
    const body = frame(3, "TXXX", txxx("prompt", JSON.stringify({ texte: "ÿ" }), 0));
    expect(readMp3Metadata(id3(3, unsync(body), 0x80))).toEqual({ prompt: { texte: "ÿ" }, workflow: null });
  });

  test("ignore une frame compressée", () => {
    const bytes = id3(4, frame(4, "TXXX", txxx("prompt", JSON.stringify(prompt)), 0x08));
    expect(readMp3Metadata(bytes)).toEqual({ prompt: null, workflow: null });
  });

  test("un mp3 sans tag ID3 donne des valeurs nulles", () => {
    expect(readMp3Metadata(AUDIO)).toEqual({ prompt: null, workflow: null });
  });

  test("refuse ce qui n'est pas un mp3", () => {
    expect(() => readMp3Metadata(ascii("RIFF...."))).toThrow("Pas un mp3");
  });

  test("refuse un mp3 tronqué", () => {
    const bytes = id3(4, frame(4, "TXXX", txxx("prompt", JSON.stringify(prompt))));
    expect(() => readMp3Metadata(bytes.subarray(0, bytes.length - 5))).toThrow("mp3 tronqué");
  });

  test("refuse ID3v2.2", () => {
    const bytes = concat([ascii("ID3"), Uint8Array.from([2, 0, 0]), synchsafe(0)]);
    expect(() => readMp3Metadata(bytes)).toThrow("ID3v2.2 non géré");
  });

  test("refuse un JSON illisible", () => {
    const bytes = id3(4, frame(4, "TXXX", txxx("prompt", "{")));
    expect(() => readMp3Metadata(bytes)).toThrow("JSON invalide dans le tag prompt");
  });
});

describe("readMp3MetadataFile", () => {
  test("lit le tag d'un fichier mp3 suivi de son audio", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mp3-metadata-"));
    directories.push(directory);
    const path = join(directory, "audio.mp3");
    const tag = id3(4, frame(4, "TXXX", txxx("prompt", JSON.stringify(prompt))), 0, 16);
    await Bun.write(path, concat([tag, AUDIO, new Uint8Array(1000)]));
    expect(await readMp3MetadataFile(path)).toEqual({ prompt, workflow: null });
  });

  test("lit un fichier mp3 sans tag", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mp3-metadata-"));
    directories.push(directory);
    const path = join(directory, "audio.mp3");
    await Bun.write(path, concat([AUDIO, new Uint8Array(100)]));
    expect(await readMp3MetadataFile(path)).toEqual({ prompt: null, workflow: null });
  });

  test("signale un fichier absent", async () => {
    await expect(readMp3MetadataFile("/tmp/comfyui-mp3-metadata-absent.mp3")).rejects.toThrow("introuvable");
  });
});
