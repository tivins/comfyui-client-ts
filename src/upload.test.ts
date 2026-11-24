import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { runGraphWithUploads, uploadImage } from "./upload.ts";

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

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:9/upload/image");
      expect(init?.method).toBe("POST");
      form = init?.body as FormData;
      return Response.json({ name: "ref (1).png", subfolder: "", type: "input" });
    }) as typeof fetch;

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
    globalThis.fetch = (async (_input) => Response.json({ name: "ref.png", subfolder: "refs", type: "input" })) as typeof fetch;

    expect(await uploadImage(path, { server: "http://127.0.0.1:9" })).toBe("refs/ref.png");
  });

  test("échoue si le serveur refuse", async () => {
    const path = await imageFile();
    globalThis.fetch = (async (_input) => new Response(null, { status: 400 })) as typeof fetch;

    expect(uploadImage(path, { server: "http://127.0.0.1:9" })).rejects.toThrow("/upload/image a répondu 400");
  });
});

describe("uploadImage avec deleteFromServer", () => {
  test("préfixe le nom envoyé d'un identifiant unique", async () => {
    const path = await imageFile();
    const names: string[] = [];
    globalThis.fetch = (async (_input, init) => {
      const image = (init?.body as FormData).get("image") as File;
      names.push(image.name);
      return Response.json({ name: image.name, subfolder: "", type: "input" });
    }) as typeof fetch;

    const settings = { server: "http://127.0.0.1:9", deleteFromServer: true };
    await uploadImage(path, settings);
    await uploadImage(path, settings);

    expect(names[0]).toMatch(/^cct-[0-9a-f]{8}-ref\.png$/);
    expect(names[1]).toMatch(/^cct-[0-9a-f]{8}-ref\.png$/);
    expect(names[0]).not.toBe(names[1]);
  });
});

describe("runGraphWithUploads", () => {
  /** Serveur qui accepte les envois, refuse le prompt (`/prompt` 400) et note les effacements. */
  function refusingServer(deleteBodies: unknown[], uploadStatus = (_n: number) => 200): typeof fetch {
    let uploads = 0;
    return (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/upload/image")) {
        uploads += 1;
        const image = (init?.body as FormData).get("image") as File;
        const status = uploadStatus(uploads);
        return status === 200
          ? Response.json({ name: image.name, subfolder: "refs", type: "input" })
          : new Response(null, { status });
      }
      if (url.endsWith("/prompt")) return Response.json({ error: { message: "graphe refusé" } }, { status: 400 });
      if (url.endsWith("/api/output/delete")) {
        deleteBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ deleted: [], missing: [] });
      }
      throw new Error(`requête inattendue : ${url}`);
    }) as typeof fetch;
  }

  test("efface les envois du dossier input quand la génération échoue, et garde son erreur", async () => {
    const path = await imageFile();
    const deleteBodies: unknown[] = [];
    globalThis.fetch = refusingServer(deleteBodies);
    let built: (string | null)[] = [];

    const error = await runGraphWithUploads([path, null], { server: "http://127.0.0.1:9", deleteFromServer: true }, (names) => {
      built = names;
      return {};
    }).catch((e) => e);

    expect(String(error)).toContain("400");
    expect(built[0]).toMatch(/^refs\/cct-[0-9a-f]{8}-ref\.png$/);
    expect(built[1]).toBeNull();
    const name = built[0]!.slice("refs/".length);
    expect(deleteBodies).toEqual([{ files: [{ filename: name, subfolder: "refs", type: "input" }] }]);
  });

  test("efface le premier envoi si le second échoue", async () => {
    const path = await imageFile();
    const deleteBodies: unknown[] = [];
    globalThis.fetch = refusingServer(deleteBodies, (n) => (n === 2 ? 500 : 200));

    const error = await runGraphWithUploads([path, path], { server: "http://127.0.0.1:9", deleteFromServer: true }, () => ({})).catch((e) => e);

    expect(String(error)).toContain("/upload/image a répondu 500");
    expect(deleteBodies).toHaveLength(1);
    expect((deleteBodies[0] as { files: unknown[] }).files).toHaveLength(1);
  });

  test("laisse les envois sans deleteFromServer", async () => {
    const path = await imageFile();
    const deleteBodies: unknown[] = [];
    globalThis.fetch = refusingServer(deleteBodies);

    await runGraphWithUploads([path], { server: "http://127.0.0.1:9" }, () => ({})).catch(() => undefined);

    expect(deleteBodies).toEqual([]);
  });
});
