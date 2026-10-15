import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  audioDuration,
  classifyDuration,
  loudnormFilter,
  nextSeed,
  normalizeLoudness,
  parseBatchArgs,
  parseLoudnorm,
  parsePlaylist,
  runBatch,
  trackOptions,
  type BatchDeps,
  type Playlist,
} from "./batch-music.ts";
import type { MiniMaxMusic3Options } from "./models/minimax-music3.ts";

const playlist: Playlist = {
  seeds: [1, 2],
  lyrics: "[Instrumental]",
  options: { maxDuration: 180 },
  tracks: [
    { id: "lofi", caption: "lo-fi" },
    { id: "piano", caption: "piano", lyrics: "[Intro]\n[Outro]", options: { maxDuration: 240, steps: 20 } },
  ],
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "batch-music-"));
  directories.push(directory);
  return directory;
}

const silent = { debug() {}, log() {}, warn() {}, error() {} };

/**
 * Faux serveur : le fichier produit contient la piste et la graine, et sa
 * durée vient de `durations` (`<caption>_s<seed>`, 100 s par défaut).
 */
function fakeDeps(durations: Record<string, number> = {}, calls: string[] = []): BatchDeps {
  return {
    async generate(options: MiniMaxMusic3Options, settings) {
      const key = `${options.caption}_s${options.seed}`;
      calls.push(key);
      if (durations[key] === -1) throw new Error("serveur indisponible");
      const path = join(settings.outputDir!, `${Date.now()}-audio.mp3`);
      await writeFile(path, key);
      return [path];
    },
    async duration(path) {
      return durations[await readFile(path, "utf8")] ?? 100;
    },
    async normalize(input, output) {
      await writeFile(output, `normalized:${await readFile(input, "utf8")}`);
    },
    logger: silent,
  };
}

describe("parsePlaylist", () => {
  test("accepte une playlist valide", () => {
    expect(parsePlaylist(playlist)).toBe(playlist);
    expect(parsePlaylist({ ...playlist, minDuration: 90, retries: 0, loudness: null })).toBeDefined();
  });

  test("refuse les champs invalides", () => {
    expect(() => parsePlaylist({ ...playlist, seeds: [] })).toThrow(/seeds/);
    expect(() => parsePlaylist({ ...playlist, seeds: [-1] })).toThrow(/seeds/);
    expect(() => parsePlaylist({ ...playlist, seeds: [1, 1] })).toThrow(/doublons/);
    expect(() => parsePlaylist({ ...playlist, lyrics: undefined })).toThrow(/lyrics/);
    expect(() => parsePlaylist({ ...playlist, minDuration: -1 })).toThrow(/minDuration/);
    expect(() => parsePlaylist({ ...playlist, retries: 1.5 })).toThrow(/retries/);
    expect(() => parsePlaylist({ ...playlist, loudness: 3 })).toThrow(/loudness/);
    expect(() => parsePlaylist({ ...playlist, tracks: [{ id: "Lo Fi", caption: "x" }] })).toThrow(/id de piste invalide/);
    expect(() =>
      parsePlaylist({ ...playlist, tracks: [{ id: "a", caption: "x" }, { id: "a", caption: "y" }] }),
    ).toThrow(/en double/);
    expect(() => parsePlaylist({ ...playlist, tracks: [{ id: "a", caption: " " }] })).toThrow(/caption vide/);
  });
});

describe("trackOptions", () => {
  test("superpose défauts, réglages communs et réglages de piste", () => {
    expect(trackOptions(playlist, playlist.tracks[0]!, 1)).toMatchObject({
      caption: "lo-fi",
      lyrics: "[Instrumental]",
      seed: 1,
      maxDuration: 180,
      steps: 30,
    });
    expect(trackOptions(playlist, playlist.tracks[1]!, 2)).toMatchObject({
      caption: "piano",
      lyrics: "[Intro]\n[Outro]",
      maxDuration: 240,
      steps: 20,
    });
  });
});

describe("nextSeed", () => {
  test("prend les graines de la playlist, puis continue après la plus grande", () => {
    expect(nextSeed([1, 2, 3], new Set())).toBe(1);
    expect(nextSeed([1, 2, 3], new Set([1, 3]))).toBe(2);
    expect(nextSeed([1, 2, 3], new Set([1, 2, 3]))).toBe(4);
    expect(nextSeed([1, 2], new Set([1, 2, 7]))).toBe(8);
  });
});

describe("classifyDuration", () => {
  test("distingue trop court, arrêté par le plafond et correct", () => {
    expect(classifyDuration(50, 90, 240)).toBe("short");
    expect(classifyDuration(150, 90, 240)).toBe("ok");
    expect(classifyDuration(239.7, 90, 240)).toBe("cut");
    expect(classifyDuration(240, 0, 240)).toBe("cut");
  });
});

describe("loudnorm", () => {
  const stderr = `[Parsed_loudnorm_0 @ 0x1]
{
\t"input_i" : "-14.32",
\t"input_tp" : "0.52",
\t"input_lra" : "4.30",
\t"input_thresh" : "-24.55",
\t"output_i" : "-16.01",
\t"target_offset" : "0.01"
}
`;

  test("lit la mesure du premier passage", () => {
    expect(parseLoudnorm(stderr)).toMatchObject({ input_i: "-14.32", input_tp: "0.52", target_offset: "0.01" });
    expect(() => parseLoudnorm("rien")).toThrow(/pas de mesure/);
    expect(() => parseLoudnorm('{"input_i": "-14"}')).toThrow(/input_tp manquant/);
  });

  test("construit les filtres des deux passages", () => {
    expect(loudnormFilter(-16)).toBe("loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json");
    expect(loudnormFilter(-16, parseLoudnorm(stderr))).toBe(
      "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-14.32:measured_TP=0.52:measured_LRA=4.30"
        + ":measured_thresh=-24.55:offset=0.01:linear=true",
    );
  });

  test("égalise un vrai fichier avec ffmpeg", async () => {
    const directory = await tempDir();
    const input = join(directory, "in.mp3");
    const output = join(directory, "out.mp3");
    const encode = Bun.spawnSync([
      "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=4",
      "-af", "volume=-30dB", "-c:a", "libmp3lame", "-q:a", "0", input,
    ]);
    expect(encode.exitCode).toBe(0);

    await normalizeLoudness(input, output, -16);

    const measure = Bun.spawnSync([
      "ffmpeg", "-hide_banner", "-nostats", "-i", output, "-af", loudnormFilter(-16), "-f", "null", "-",
    ]);
    const loudness = Number(parseLoudnorm(measure.stderr.toString()).input_i);
    expect(loudness).toBeGreaterThan(-17.5);
    expect(loudness).toBeLessThan(-14.5);
    expect(Math.abs((await audioDuration(output)) - 4)).toBeLessThan(0.2);
  });
});

describe("runBatch", () => {
  test("génère tour par tour, égalise et note chaque essai", async () => {
    const outDir = await tempDir();
    const calls: string[] = [];

    const summary = await runBatch(playlist, { name: "focus", outDir, server: "http://x" }, fakeDeps({}, calls));

    expect(calls).toEqual(["lo-fi_s1", "piano_s1", "lo-fi_s2", "piano_s2"]);
    expect(summary.kept).toEqual(["lofi_s1.mp3", "piano_s1.mp3", "lofi_s2.mp3", "piano_s2.mp3"]);
    expect(await readFile(join(outDir, "lofi_s1.mp3"), "utf8")).toBe("normalized:lo-fi_s1");
    expect((await readdir(outDir)).sort()).toEqual(["lofi_s1.mp3", "lofi_s2.mp3", "piano_s1.mp3", "piano_s2.mp3", "report.tsv"]);
    expect((await readFile(join(outDir, "report.tsv"), "utf8")).split("\n")[0]).toMatch(/^lofi_s1\.mp3\t1\t100\.0\tok\t\d+$/);
  });

  test("met de côté un morceau trop court et essaie la graine suivante", async () => {
    const outDir = await tempDir();
    const calls: string[] = [];
    const short = { ...playlist, minDuration: 60, retries: 1, tracks: [playlist.tracks[0]!] };

    const summary = await runBatch(
      short,
      { name: "focus", outDir, server: "http://x" },
      fakeDeps({ "lo-fi_s1": 30, "lo-fi_s3": 20, "lo-fi_s4": 20 }, calls),
    );

    // Tour 1 : s1 trop court, s2 gardé. Tour 2 : s3 et s4 trop courts, plus d'essai.
    expect(calls).toEqual(["lo-fi_s1", "lo-fi_s2", "lo-fi_s3", "lo-fi_s4"]);
    expect(summary.rejected).toEqual(["lofi_s1.mp3", "lofi_s3.mp3", "lofi_s4.mp3"]);
    expect(summary.kept).toEqual(["lofi_s2.mp3"]);
    expect((await readdir(join(outDir, "rejected"))).sort()).toEqual(["lofi_s1.mp3", "lofi_s3.mp3", "lofi_s4.mp3"]);

    // Reprise : les graines déjà vues ne sont pas refaites.
    calls.length = 0;
    await runBatch(short, { name: "focus", outDir, server: "http://x" }, fakeDeps({ "lo-fi_s5": 90 }, calls));
    expect(calls).toEqual(["lo-fi_s5"]);
    expect((await readdir(outDir)).filter((name) => name.endsWith(".mp3")).sort()).toEqual(["lofi_s2.mp3", "lofi_s5.mp3"]);
  });

  test("garde un morceau arrêté par le plafond et le signale", async () => {
    const outDir = await tempDir();
    const summary = await runBatch(
      { ...playlist, seeds: [1], tracks: [playlist.tracks[0]!] },
      { name: "focus", outDir, server: "http://x" },
      fakeDeps({ "lo-fi_s1": 180 }),
    );
    expect(summary.kept).toEqual(["lofi_s1.mp3"]);
    expect(summary.cut).toEqual(["lofi_s1.mp3"]);
  });

  test("laisse le fichier tel quel sans égalisation", async () => {
    const outDir = await tempDir();
    await runBatch(
      { ...playlist, seeds: [1], loudness: null, tracks: [playlist.tracks[0]!] },
      { name: "focus", outDir, server: "http://x" },
      fakeDeps(),
    );
    expect(await readFile(join(outDir, "lofi_s1.mp3"), "utf8")).toBe("lo-fi_s1");
  });

  test("note un échec et passe à la piste suivante", async () => {
    const outDir = await tempDir();
    const calls: string[] = [];
    const summary = await runBatch(
      { ...playlist, seeds: [1] },
      { name: "focus", outDir, server: "http://x" },
      fakeDeps({ "lo-fi_s1": -1 }, calls),
    );
    expect(calls).toEqual(["lo-fi_s1", "piano_s1"]);
    expect(summary.failed).toEqual(["lofi_s1.mp3"]);
    expect(summary.kept).toEqual(["piano_s1.mp3"]);
  });

  test("respecte --only et --count, et ne génère rien en --dry-run", async () => {
    const outDir = await tempDir();
    const calls: string[] = [];

    await runBatch(playlist, { name: "focus", outDir, server: "http://x", dryRun: true }, fakeDeps({}, calls));
    expect(calls).toEqual([]);

    await runBatch(playlist, { name: "focus", outDir, server: "http://x", only: ["piano"], count: 3 }, fakeDeps({}, calls));
    expect(calls).toEqual(["piano_s1", "piano_s2", "piano_s3"]);

    await expect(
      runBatch(playlist, { name: "focus", outDir, server: "http://x", only: ["jazz"] }, fakeDeps()),
    ).rejects.toThrow(/pistes inconnues : jazz/);
  });
});

describe("parseBatchArgs", () => {
  test("lit le fichier, les filtres et le dossier de sortie par défaut", () => {
    const args = parseBatchArgs(["--only", "a,b", "playlists/focus.json", "--count", "4", "--dry-run"]);

    expect(args.playlist).toBe("playlists/focus.json");
    expect(args.only).toEqual(["a", "b"]);
    expect(args.count).toBe(4);
    expect(args.dryRun).toBe(true);
    expect(args.outDir).toEndWith("output/music/focus");
    expect(args.server).toBe("http://127.0.0.1:8188");
  });

  test("prend --out et --server", () => {
    const args = parseBatchArgs(["p.json", "--out", "/music", "--server", "http://gpu:8188/"]);
    expect(args.outDir).toBe("/music");
    expect(args.server).toBe("http://gpu:8188");
    expect(args.count).toBeUndefined();
    expect(args.dryRun).toBe(false);
  });

  test("refuse un appel sans playlist ou un --count invalide", () => {
    expect(() => parseBatchArgs(["--out", "/music"])).toThrow(/usage/);
    expect(() => parseBatchArgs(["p.json", "--count", "0"])).toThrow(/--count/);
  });
});
