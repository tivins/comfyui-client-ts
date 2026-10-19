import {appendFile, mkdir, readdir, rename, rm} from "node:fs/promises";
import {basename, dirname, extname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {DEFAULT_SERVER, type GenerateSettings} from "./client";
import type {Logger} from "./logger";
import {generateMiniMaxMusic3, MINIMAX_MUSIC3_DEFAULTS, type MiniMaxMusic3Options} from "./models/minimax-music3";

type Settings = Partial<Omit<MiniMaxMusic3Options, "caption" | "lyrics" | "seed">>;

export type PlaylistTrack = {
    /** Sert au nom des fichiers : `<id>_s<seed>.mp3`. */
    id: string;
    caption: string;
    /** Remplace `Playlist.lyrics` pour cette piste. */
    lyrics?: string;
    /** Remplace `Playlist.options` champ par champ pour cette piste. */
    options?: Settings;
};

export type Playlist = {
    /** Graines essayées en premier. Leur nombre fixe combien de morceaux garder par piste. */
    seeds: number[];
    /** Paroles communes. Pour un instrumental, des balises seules (`[Instrumental]`). */
    lyrics: string;
    /** Réglages communs, par-dessus `MINIMAX_MUSIC3_DEFAULTS`. */
    options?: Settings;
    /** Durée minimale en secondes. Un morceau plus court part dans `rejected/` et une autre graine est essayée. */
    minDuration?: number;
    /** Graines de remplacement essayées au plus pour un même morceau. Défaut : 2. */
    retries?: number;
    /** Volume visé en LUFS, crête à -1.5 dBTP. `null` : fichiers laissés tels quels. Défaut : -16. */
    loudness?: number | null;
    tracks: PlaylistTrack[];
};

export const DEFAULT_RETRIES = 2;
export const DEFAULT_LOUDNESS = -16;
const TRUE_PEAK = -1.5;
/** Un morceau qui atteint `maxDuration` à cette marge près a été arrêté par le plafond, pas par le modèle. */
const CUT_MARGIN = 0.5;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isSeed(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Vérifie la forme d'une playlist lue en JSON. */
export function parsePlaylist(data: unknown): Playlist {
    const playlist = data as Playlist;
    if (typeof data !== "object" || data === null) {
        throw new Error("la playlist doit être un objet JSON");
    }
    if (!Array.isArray(playlist.seeds) || playlist.seeds.length === 0 || !playlist.seeds.every(isSeed)) {
        throw new Error("seeds doit être une liste non vide d'entiers >= 0");
    }
    if (new Set(playlist.seeds).size !== playlist.seeds.length) {
        throw new Error("seeds contient des doublons");
    }
    if (typeof playlist.lyrics !== "string") {
        throw new Error("lyrics doit être une chaîne");
    }
    if (playlist.minDuration !== undefined && !(typeof playlist.minDuration === "number" && playlist.minDuration >= 0)) {
        throw new Error("minDuration doit être un nombre >= 0");
    }
    if (playlist.retries !== undefined && !isSeed(playlist.retries)) {
        throw new Error("retries doit être un entier >= 0");
    }
    if (playlist.loudness !== undefined && playlist.loudness !== null
        && !(typeof playlist.loudness === "number" && playlist.loudness < 0)) {
        throw new Error("loudness doit être un nombre < 0 (LUFS) ou null");
    }
    if (!Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
        throw new Error("tracks doit être une liste non vide");
    }
    const ids = new Set<string>();
    for (const track of playlist.tracks) {
        if (typeof track.id !== "string" || !ID_PATTERN.test(track.id)) {
            throw new Error(`id de piste invalide : ${JSON.stringify(track.id)} (minuscules, chiffres, tirets)`);
        }
        if (ids.has(track.id)) {
            throw new Error(`id de piste en double : ${track.id}`);
        }
        ids.add(track.id);
        if (typeof track.caption !== "string" || track.caption.trim() === "") {
            throw new Error(`caption vide pour ${track.id}`);
        }
        if (track.lyrics !== undefined && typeof track.lyrics !== "string") {
            throw new Error(`lyrics doit être une chaîne pour ${track.id}`);
        }
    }
    return playlist;
}

/** Réglages d'un morceau : défauts, puis réglages communs, puis ceux de la piste. */
export function trackOptions(playlist: Playlist, track: PlaylistTrack, seed: number): MiniMaxMusic3Options {
    return {
        ...MINIMAX_MUSIC3_DEFAULTS,
        ...playlist.options,
        ...track.options,
        caption: track.caption,
        lyrics: track.lyrics ?? playlist.lyrics,
        seed,
    };
}

/** Première graine de `seeds` pas encore utilisée ; au-delà, la plus grande graine connue + 1, + 2… */
export function nextSeed(seeds: readonly number[], used: ReadonlySet<number>): number {
    const free = seeds.find(seed => !used.has(seed));
    if (free !== undefined) return free;
    let seed = Math.max(...seeds, ...used) + 1;
    while (used.has(seed)) seed++;
    return seed;
}

export type DurationStatus = "ok" | "short" | "cut";

/** `short` sous `minDuration` ; `cut` quand le plafond `maxDuration` a arrêté le morceau. */
export function classifyDuration(duration: number, minDuration: number, maxDuration: number): DurationStatus {
    if (duration < minDuration) return "short";
    if (duration >= maxDuration - CUT_MARGIN) return "cut";
    return "ok";
}

export type LoudnormMeasure = {
    input_i: string;
    input_tp: string;
    input_lra: string;
    input_thresh: string;
    target_offset: string;
};

/** Lit le bloc JSON que `loudnorm=print_format=json` écrit à la fin de la sortie d'erreur de ffmpeg. */
export function parseLoudnorm(stderr: string): LoudnormMeasure {
    const start = stderr.lastIndexOf("{");
    const end = stderr.lastIndexOf("}");
    if (start === -1 || end < start) {
        throw new Error("ffmpeg loudnorm : pas de mesure dans la sortie");
    }
    const measure = JSON.parse(stderr.slice(start, end + 1)) as LoudnormMeasure;
    for (const key of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"] as const) {
        if (typeof measure[key] !== "string") {
            throw new Error(`ffmpeg loudnorm : ${key} manquant`);
        }
    }
    return measure;
}

/** Filtre `loudnorm` : mesure seule (premier passage) ou correction linéaire à partir de la mesure. */
export function loudnormFilter(lufs: number, measure?: LoudnormMeasure): string {
    const target = `loudnorm=I=${lufs}:TP=${TRUE_PEAK}:LRA=11`;
    if (measure === undefined) return `${target}:print_format=json`;
    return `${target}:measured_I=${measure.input_i}:measured_TP=${measure.input_tp}`
        + `:measured_LRA=${measure.input_lra}:measured_thresh=${measure.input_thresh}`
        + `:offset=${measure.target_offset}:linear=true`;
}

async function run(command: string[]): Promise<string> {
    const process = Bun.spawn(command, {stdout: "pipe", stderr: "pipe"});
    const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
    ]);
    if (code !== 0) {
        throw new Error(`${command[0]} a échoué (${code}) : ${stderr.trim().split("\n").at(-1)}`);
    }
    return stdout + stderr;
}

async function probe(path: string, entry: string): Promise<string> {
    return (await run(["ffprobe", "-v", "error", "-show_entries", entry, "-of", "csv=p=0", path])).trim();
}

/** Durée en secondes, lue par ffprobe. */
export async function audioDuration(path: string): Promise<number> {
    return Number(await probe(path, "format=duration"));
}

/** Égalise le volume en deux passages `loudnorm` et réencode en mp3 V0. Les métadonnées (graphe ComfyUI) sont gardées. */
export async function normalizeLoudness(input: string, output: string, lufs: number): Promise<void> {
    const measure = parseLoudnorm(
        await run(["ffmpeg", "-hide_banner", "-nostats", "-i", input, "-af", loudnormFilter(lufs), "-f", "null", "-"]),
    );
    const sampleRate = await probe(input, "stream=sample_rate");
    await run([
        "ffmpeg", "-hide_banner", "-nostats", "-y", "-i", input,
        "-af", loudnormFilter(lufs, measure), "-ar", sampleRate,
        "-map_metadata", "0", "-c:a", "libmp3lame", "-q:a", "0", output,
    ]);
}

export type BatchDeps = {
    generate: (options: MiniMaxMusic3Options, settings: GenerateSettings) => Promise<string[]>;
    duration: (path: string) => Promise<number>;
    normalize: (input: string, output: string, lufs: number) => Promise<void>;
    logger: Logger;
};

export type BatchRun = {
    /** Nom de la playlist, posé dans `meta`. */
    name: string;
    outDir: string;
    server: string;
    only?: string[];
    /** Morceaux à garder par piste. Défaut : le nombre de `seeds`. */
    count?: number;
    dryRun?: boolean;
};

export type BatchSummary = {
    kept: string[];
    /** Gardés, mais arrêtés par le plafond `maxDuration`. */
    cut: string[];
    /** Trop courts, déplacés dans `rejected/`. */
    rejected: string[];
    failed: string[];
};

const FILE_PATTERN = /^([a-z0-9][a-z0-9-]*)_s(\d+)\.mp3$/;

/** Graines déjà présentes par piste dans `directory`. */
async function seedsOnDisk(directory: string): Promise<Map<string, Set<number>>> {
    const found = new Map<string, Set<number>>();
    const names = await readdir(directory).catch(() => [] as string[]);
    for (const name of names) {
        const match = FILE_PATTERN.exec(name);
        if (!match) continue;
        const seeds = found.get(match[1]!) ?? new Set<number>();
        seeds.add(Number(match[2]));
        found.set(match[1]!, seeds);
    }
    return found;
}

/**
 * Génère les morceaux qui manquent, tour par tour : au tour `n`, chaque piste
 * reçoit son `n`-ième morceau. Les premiers fichiers couvrent ainsi tous les
 * styles. Un morceau sous `minDuration` part dans `rejected/` et la graine
 * suivante est essayée, `retries` fois au plus. Les fichiers déjà présents
 * (gardés ou rejetés) ne sont pas refaits. Chaque essai ajoute une ligne à
 * `report.tsv`.
 */
export async function runBatch(playlist: Playlist, batch: BatchRun, deps: BatchDeps): Promise<BatchSummary> {
    const unknown = (batch.only ?? []).filter(id => !playlist.tracks.some(track => track.id === id));
    if (unknown.length > 0) {
        throw new Error(`pistes inconnues : ${unknown.join(", ")}`);
    }
    const tracks = batch.only ? playlist.tracks.filter(track => batch.only!.includes(track.id)) : playlist.tracks;
    const count = batch.count ?? playlist.seeds.length;
    const minDuration = playlist.minDuration ?? 0;
    const retries = playlist.retries ?? DEFAULT_RETRIES;
    const loudness = playlist.loudness === undefined ? DEFAULT_LOUDNESS : playlist.loudness;
    const rejectedDir = join(batch.outDir, "rejected");
    const tmpDir = join(batch.outDir, ".tmp");

    const kept = await seedsOnDisk(batch.outDir);
    const rejected = await seedsOnDisk(rejectedDir);
    const used = (id: string) => new Set([...(kept.get(id) ?? []), ...(rejected.get(id) ?? [])]);
    const keptCount = (id: string) => kept.get(id)?.size ?? 0;

    const missing = tracks.reduce((sum, track) => sum + Math.max(0, count - keptCount(track.id)), 0);
    deps.logger.log(`${batch.name} : ${count} par piste, ${tracks.length} pistes, ${missing} morceaux à générer → ${batch.outDir}`);
    const summary: BatchSummary = {kept: [], cut: [], rejected: [], failed: []};
    if (batch.dryRun) {
        for (const track of tracks) {
            const left = count - keptCount(track.id);
            if (left > 0) deps.logger.log(`  ${track.id} : ${left} à faire, prochaine graine ${nextSeed(playlist.seeds, used(track.id))}`);
        }
        return summary;
    }

    await mkdir(tmpDir, {recursive: true});
    const report = join(batch.outDir, "report.tsv");
    let done = 0;
    for (let round = 0; round < count; round++) {
        for (const track of tracks) {
            for (let attempt = 0; keptCount(track.id) <= round && attempt <= retries; attempt++) {
                const seed = nextSeed(playlist.seeds, used(track.id));
                const file = `${track.id}_s${seed}.mp3`;
                const options = trackOptions(playlist, track, seed);
                const started = Date.now();
                deps.logger.log(`[${++done}] ${file}`);
                try {
                    const [path] = await deps.generate(options, {
                        server: batch.server,
                        outputDir: tmpDir,
                        deleteFromServer: true,
                        meta: {playlist: batch.name, track: track.id, seed},
                    });
                    const duration = await deps.duration(path!);
                    const status = classifyDuration(duration, minDuration, options.maxDuration);
                    const seconds = Math.round((Date.now() - started) / 1000);
                    await appendFile(report, `${file}\t${seed}\t${duration.toFixed(1)}\t${status}\t${seconds}\n`);
                    if (status === "short") {
                        await mkdir(rejectedDir, {recursive: true});
                        await rename(path!, join(rejectedDir, file));
                        rejected.set(track.id, (rejected.get(track.id) ?? new Set<number>()).add(seed));
                        summary.rejected.push(file);
                        deps.logger.warn(`  trop court (${Math.round(duration)} s < ${minDuration} s), mis dans rejected/`);
                        continue;
                    }
                    if (loudness === null) {
                        await rename(path!, join(batch.outDir, file));
                    } else {
                        const normalized = join(tmpDir, file);
                        await deps.normalize(path!, normalized, loudness);
                        await rename(normalized, join(batch.outDir, file));
                        await rm(path!, {force: true});
                    }
                    kept.set(track.id, (kept.get(track.id) ?? new Set<number>()).add(seed));
                    summary.kept.push(file);
                    if (status === "cut") {
                        summary.cut.push(file);
                        deps.logger.warn(`  arrêté par le plafond (${options.maxDuration} s) : fin sans doute coupée`);
                    }
                    deps.logger.log(`  ${Math.round(duration)} s de musique, en ${seconds} s`);
                } catch (error) {
                    deps.logger.error(`  échec : ${error instanceof Error ? error.message : String(error)}`);
                    summary.failed.push(file);
                    break;
                }
            }
        }
    }
    await rm(tmpDir, {recursive: true, force: true});
    return summary;
}

function readFlag(argv: readonly string[], name: string): string | undefined {
    const index = argv.indexOf(`--${name}`);
    if (index === -1) return undefined;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${name} attend une valeur`);
    }
    return value;
}

export type BatchArgs = Omit<BatchRun, "name"> & { playlist: string; dryRun: boolean };

/** `argv` sans `bun` ni le script : le premier argument libre est le fichier de playlist. */
export function parseBatchArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): BatchArgs {
    const valueFlags = ["--out", "--only", "--count", "--server"];
    const playlist = argv.find((arg, index) => !arg.startsWith("--") && !valueFlags.includes(argv[index - 1] ?? ""));
    if (playlist === undefined) {
        throw new Error("usage : bun batch-music <playlist.json> [--out dir] [--only id,id] [--count n] [--server url] [--dry-run]");
    }
    const rawCount = readFlag(argv, "count");
    if (rawCount !== undefined && !/^[1-9]\d*$/.test(rawCount)) {
        throw new Error("--count attend un entier >= 1");
    }
    const name = basename(playlist, extname(playlist));
    return {
        playlist,
        outDir: readFlag(argv, "out") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "output", "music", name),
        server: (readFlag(argv, "server") ?? env.COMFY_URL ?? DEFAULT_SERVER).replace(/\/$/, ""),
        only: readFlag(argv, "only")?.split(",").map(item => item.trim()).filter(item => item !== ""),
        count: rawCount === undefined ? undefined : Number(rawCount),
        dryRun: argv.includes("--dry-run"),
    };
}

async function main(): Promise<void> {
    const args = parseBatchArgs(process.argv.slice(2), process.env);
    const playlist = parsePlaylist(await Bun.file(args.playlist).json());
    const name = basename(args.playlist, extname(args.playlist));
    const summary = await runBatch(playlist, {...args, name}, {
        generate: generateMiniMaxMusic3,
        duration: audioDuration,
        normalize: normalizeLoudness,
        logger: console,
    });
    if (args.dryRun) return;

    console.log(`${summary.kept.length} gardés, ${summary.rejected.length} trop courts, ${summary.failed.length} échecs`);
    if (summary.cut.length > 0) console.warn(`fin coupée par le plafond : ${summary.cut.join(", ")}`);
    if (summary.failed.length > 0) {
        console.error(`échecs : ${summary.failed.join(", ")}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
