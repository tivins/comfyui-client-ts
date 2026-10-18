import type { PngMetadata } from "./png-metadata";

/** Métadonnées ComfyUI lues dans un mp3 : mêmes champs que `PngMetadata`. `null` si le tag est absent. */
export type Mp3Metadata = PngMetadata;

const TEXT_KEYS = new Set(["prompt", "workflow"]);

const HEADER_SIZE = 10;

function isMpegFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

function hasId3(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
}

/** Entier sur 4 octets de 7 bits utiles. */
function readSynchsafe(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 21) | (bytes[offset + 1]! << 14) | (bytes[offset + 2]! << 7) | bytes[offset + 3]!) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

/** Retire la désynchronisation : chaque `FF 00` redevient `FF`. */
function resync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index++) {
    out[length++] = bytes[index]!;
    if (bytes[index] === 0xff && bytes[index + 1] === 0) index++;
  }
  return out.subarray(0, length);
}

function decodeText(encoding: number, bytes: Uint8Array): string {
  switch (encoding) {
    case 0:
      return new TextDecoder("latin1").decode(bytes);
    case 1:
      // UTF-16 avec BOM ; sans BOM, petit-boutiste par défaut.
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
      return new TextDecoder("utf-16le").decode(bytes);
    case 2:
      return new TextDecoder("utf-16be").decode(bytes);
    case 3:
      return new TextDecoder().decode(bytes);
  }
  throw new Error(`Encodage ID3 inconnu : ${encoding}`);
}

/** Fin de la description : un NUL (latin-1, UTF-8) ou deux NUL alignés (UTF-16). */
function indexOfTerminator(bytes: Uint8Array, wide: boolean): number {
  const step = wide ? 2 : 1;
  for (let index = 0; index + step <= bytes.length; index += step) {
    if (bytes[index] === 0 && (!wide || bytes[index + 1] === 0)) return index;
  }
  return -1;
}

/** Frame `TXXX` : encodage, description, NUL, valeur. */
function readTxxx(data: Uint8Array): { key: string; value: string } | null {
  if (data.length < 2) return null;
  const encoding = data[0]!;
  const wide = encoding === 1 || encoding === 2;
  const body = data.subarray(1);
  const end = indexOfTerminator(body, wide);
  if (end < 0) return null;
  const key = decodeText(encoding, body.subarray(0, end));
  const value = decodeText(encoding, body.subarray(end + (wide ? 2 : 1))).replace(/\0+$/, "");
  return { key, value };
}

function parseTagJson(key: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON invalide dans le tag ${key}`);
  }
}

/**
 * Lit les tags `prompt` et `workflow` d'un mp3 ComfyUI : des frames ID3v2 `TXXX`
 * (ID3v2.3 et 2.4). Le premier tag de chaque clé l'emporte. Les autres frames sont ignorées.
 */
export function readMp3Metadata(mp3: Uint8Array): Mp3Metadata {
  if (!hasId3(mp3)) {
    if (isMpegFrame(mp3)) return { prompt: null, workflow: null };
    throw new Error("Pas un mp3");
  }
  if (mp3.length < HEADER_SIZE) throw new Error("mp3 tronqué");

  const version = mp3[3]!;
  if (version !== 3 && version !== 4) throw new Error(`ID3v2.${version} non géré`);
  const flags = mp3[5]!;
  const tagEnd = HEADER_SIZE + readSynchsafe(mp3, 6);
  if (tagEnd > mp3.length) throw new Error("mp3 tronqué");

  let tag = mp3.subarray(HEADER_SIZE, tagEnd);
  // En 2.3, la désynchronisation porte sur tout le tag ; en 2.4, sur chaque frame.
  if (version === 3 && flags & 0x80) tag = resync(tag);

  let offset = 0;
  if (flags & 0x40) {
    if (tag.length < 4) throw new Error("mp3 tronqué");
    offset = version === 4 ? readSynchsafe(tag, 0) : 4 + readUint32(tag, 0);
  }

  let prompt: unknown | null = null;
  let workflow: unknown | null = null;

  while (offset + HEADER_SIZE <= tag.length) {
    // Un octet nul ouvre le remplissage.
    if (tag[offset] === 0) break;
    const id = String.fromCharCode(tag[offset]!, tag[offset + 1]!, tag[offset + 2]!, tag[offset + 3]!);
    const size = version === 4 ? readSynchsafe(tag, offset + 4) : readUint32(tag, offset + 4);
    const formatFlags = tag[offset + 9]!;
    const dataStart = offset + HEADER_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > tag.length) throw new Error("mp3 tronqué");
    offset = dataEnd;
    if (id !== "TXXX") continue;

    // Frames compressées ou chiffrées : ignorées.
    const skipped = version === 4 ? formatFlags & 0x0c : formatFlags & 0xc0;
    if (skipped) continue;

    let data = tag.subarray(dataStart, dataEnd);
    if (version === 4) {
      if (formatFlags & 0x01) data = data.subarray(4);
      if (formatFlags & 0x02) data = resync(data);
    }

    const text = readTxxx(data);
    if (text && TEXT_KEYS.has(text.key)) {
      const value = parseTagJson(text.key, text.value);
      if (text.key === "prompt" && prompt === null) prompt = value;
      if (text.key === "workflow" && workflow === null) workflow = value;
    }
  }

  return { prompt, workflow };
}

/** Lit un fichier mp3 et en extrait `prompt` et `workflow`. Seul le tag ID3 est lu, pas l'audio. */
export async function readMp3MetadataFile(path: string): Promise<Mp3Metadata> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Fichier introuvable : ${path}`);
  const head = await file.slice(0, HEADER_SIZE).bytes();
  const length = hasId3(head) && head.length === HEADER_SIZE ? HEADER_SIZE + readSynchsafe(head, 6) : HEADER_SIZE;
  return readMp3Metadata(await file.slice(0, length).bytes());
}
