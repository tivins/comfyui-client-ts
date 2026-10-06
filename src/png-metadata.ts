import { inflateSync } from "node:zlib";

/** Métadonnées ComfyUI lues dans un PNG. `null` si le chunk est absent. */
export type PngMetadata = {
  /** Graphe API exécuté. */
  prompt: unknown | null;
  /** Graphe de l'interface. Absent quand l'image a été produite sans `extra_pnginfo`. */
  workflow: unknown | null;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const TEXT_KEYS = new Set(["prompt", "workflow"]);

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function chunkType(bytes: Uint8Array): string {
  return String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
}

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function indexOfNul(bytes: Uint8Array, start: number): number {
  for (let index = start; index < bytes.length; index++) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}

function inflate(bytes: Uint8Array): Uint8Array {
  try {
    return inflateSync(bytes);
  } catch {
    throw new Error("Chunk PNG compressé illisible");
  }
}

function parseChunkJson(key: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON invalide dans le chunk ${key}`);
  }
}

/** keyword latin-1, NUL, puis le texte. `compressed` indique un octet de méthode avant le texte. */
function readKeywordText(data: Uint8Array, compressed: boolean): { key: string; text: Uint8Array } | null {
  const nul = indexOfNul(data, 0);
  if (nul <= 0) return null;
  const key = decodeLatin1(data.subarray(0, nul));
  let textStart = nul + 1;
  if (compressed) {
    if (textStart >= data.length) return null;
    if (data[textStart] !== 0) throw new Error(`Compression PNG non gérée dans le chunk ${key}`);
    textStart += 1;
  }
  return { key, text: data.subarray(textStart) };
}

function readItxt(data: Uint8Array): { key: string; value: string } | null {
  const keywordEnd = indexOfNul(data, 0);
  if (keywordEnd <= 0 || keywordEnd + 2 >= data.length) return null;
  const key = decodeLatin1(data.subarray(0, keywordEnd));
  const compressionFlag = data[keywordEnd + 1]!;
  const compressionMethod = data[keywordEnd + 2]!;
  if (compressionFlag > 1) return null;
  if (compressionFlag === 1 && compressionMethod !== 0) {
    throw new Error(`Compression PNG non gérée dans le chunk ${key}`);
  }

  const languageEnd = indexOfNul(data, keywordEnd + 3);
  if (languageEnd < 0) return null;
  const translatedEnd = indexOfNul(data, languageEnd + 1);
  if (translatedEnd < 0) return null;

  let text = data.subarray(translatedEnd + 1);
  if (compressionFlag === 1) text = inflate(text);
  return { key, value: new TextDecoder().decode(text) };
}

function readTextChunk(type: string, data: Uint8Array): { key: string; value: string } | null {
  if (type === "iTXt") return readItxt(data);

  if (type !== "tEXt" && type !== "zTXt" && type !== "comf") return null;
  const parsed = readKeywordText(data, type === "zTXt");
  if (!parsed) return null;
  const text = type === "zTXt" ? inflate(parsed.text) : parsed.text;
  return { key: parsed.key, value: decodeLatin1(text) };
}

/**
 * Lit les chunks `prompt` et `workflow` d'un PNG ComfyUI.
 * Le premier chunk de chaque clé l'emporte. Les autres textes sont ignorés.
 */
export function readPngMetadata(png: Uint8Array): PngMetadata {
  if (!isPng(png)) throw new Error("Pas un PNG");

  let prompt: unknown | null = null;
  let workflow: unknown | null = null;
  let offset = PNG_SIGNATURE.length;
  let sawEnd = false;

  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error("PNG tronqué");
    const length = readUint32(png, offset);
    const type = chunkType(png.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("PNG tronqué");
    const data = png.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    const text = readTextChunk(type, data);
    if (text && TEXT_KEYS.has(text.key)) {
      const value = parseChunkJson(text.key, text.value);
      if (text.key === "prompt" && prompt === null) prompt = value;
      if (text.key === "workflow" && workflow === null) workflow = value;
    }

    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }

  if (!sawEnd) throw new Error("PNG tronqué");
  return { prompt, workflow };
}

/** Lit un fichier PNG et en extrait `prompt` et `workflow`. */
export async function readPngMetadataFile(path: string): Promise<PngMetadata> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Fichier introuvable : ${path}`);
  return readPngMetadata(await file.bytes());
}
