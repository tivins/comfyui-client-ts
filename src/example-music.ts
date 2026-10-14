import {type GenerateSettings} from "./client";
import {generateMiniMaxMusic3, MINIMAX_MUSIC3_DEFAULTS, type MiniMaxMusic3Options} from "./models/minimax-music3";

// Caption écrite selon `docs/MiniMax-Music3-main/skills/music-caption-rewriter`,
// famille `index-cinematic-orchestral-epic.md` (orchestre + chœur, hymne épique).
const caption = `Global Metadata
Cinematic orchestral epic with choral anthem elements. Around 84 BPM, D minor, moving to the relative F major in the final chorus. The emotional arc starts in cold, distant stillness, gathers resolve through a narrative verse, breaks into a defiant, soaring chorus, falls back to a fragile, reflective bridge, then rises to a triumphant final climax that settles into quiet awe. Trailer-scale soundstage: wide concert-hall reverb, deep low end from low strings and taiko, bright high strings and cymbals on top; spacious and dynamic in the quiet sections, dense and powerful at the peaks.

Vocal Details
Singer A (Female): clear, resonant mezzo-soprano, intimate and restrained in the verse, opening into a powerful, sustained belt in the choruses. A large mixed choir answers her: wordless sustained "aah" pads in the intro, homophonic block harmonies under the choruses, and a full-voiced unison line on the final chorus. Light plate reverb and a short delay on the lead keep it present; the choir sits in a large hall reverb behind the orchestra.

Arrangement
Intro: low string drone and a slow solo cello line over distant timpani rolls; the choir enters softly with a sustained "aah" chord.
Verse: sparse piano arpeggios join the cello; violas add a slow pulse; low frame drums keep a steady, march-like heartbeat under the lead vocal.
Pre-Chorus: violins start a staccato ostinato, horns swell in long notes, a riser and a reverse cymbal lead into the chorus.
Chorus: full orchestra — sweeping legato violins, trumpets and trombones playing a heroic counter-line, taiko and big low impacts on the downbeats, crash cymbals; the choir doubles the lead in block harmonies.
Bridge: the orchestra drops away to solo piano and a high, soft string pad; the lead sings alone, then the choir hums underneath and the timpani rebuild the tension.
Final Chorus: modulation up, everything returns bigger — brass fanfare, full choir in unison, double-time taiko pattern, sustained high violins.
Outro: brass and drums cut on a final hit; the choir holds a long major chord that fades into the low string drone and a last cello note.`;

const lyrics = `[Intro]
Aah...

[Verse]
Cold wind over the harbor stone
Every lantern burning low
We were told to wait for dawn
But the dawn forgot our names

[Pre-Chorus]
So we raise the broken sail
And we turn our faces to the storm

[Chorus]
Rise, we are the fire in the dark
Rise, carry the light from heart to heart
No sea can hold us, no night can bind
We leave the ashes of fear behind

[Bridge]
And if I fall, remember me
As the spark that crossed the sea

[Chorus]
Rise, we are the fire in the dark
Rise, carry the light from heart to heart
No sea can hold us, no night can bind
We leave the ashes of fear behind

[Outro]
Aah...`;

const options: MiniMaxMusic3Options = {
    ...MINIMAX_MUSIC3_DEFAULTS,
    caption,
    lyrics,
    seed: 420,
    maxDuration: 180,
};

const settings: GenerateSettings = {
    server: "http://127.0.0.1:8188",
    outputDir: "/tmp/comfy/out",
    deleteFromServer: true,
    logger: console,
};

if (import.meta.main) {
    generateMiniMaxMusic3(options, settings).then(paths => {
        console.log("paths=", paths);
    }).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
