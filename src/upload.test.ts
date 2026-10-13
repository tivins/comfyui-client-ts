import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { uploadImage } from "./upload.ts";

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function imageFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "upload-"));
  directories.push(directory);
  const path = join(directory, "ref.png");
  await writeFile(path, new Uint8Array([1, 2, 3]));
  return path;
}

describe("uploadImage", () => {
  test("envoie le fichier en multipart et renvoie le nom donné par le serveur", async () => {
    const path = await imageFile();
    let form: FormData | undefined;

    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:9/upload/image");
      expect(init?.method).toBe("POST");
      form = init?.body as FormData;
      return Response.json({ name: "ref (1).png", subfolder: "", type: "input" });
    };

    const name = await uploadImage(path, { server: "http://127.0.0.1:9/" });

    expect(name).toBe("ref (1).png");
    const image = form?.get("image") as File;
    expect(image.name).toBe("ref.png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(form?.get("type")).toBe("input");
    expect(form?.has("overwrite")).toBe(false);
  });

  test("préfixe le sous-dossier", async () => {
    const path = await imageFile();
    globalThis.fetch = async () => Response.json({ name: "ref.png", subfolder: "refs", type: "input" });

    expect(await uploadImage(path, { server: "http://127.0.0.1:9" })).toBe("refs/ref.png");
  });

  test("échoue si le serveur refuse", async () => {
    const path = await imageFile();
    globalThis.fetch = async () => new Response(null, { status: 400 });

    expect(uploadImage(path, { server: "http://127.0.0.1:9" })).rejects.toThrow("/upload/image a répondu 400");
  });
});
