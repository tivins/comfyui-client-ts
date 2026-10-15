# comfyui-client

Client Bun qui envoie des graphes API (Qwen Image 2.1, Krea 2, Wan 2.2, MiniMax Music 3) à un serveur ComfyUI, attend la fin du prompt, et enregistre les fichiers produits en local.

| Fichier | Contenu |
| --- | --- |
| `src/client.ts` | `runGraph` (envoi, attente, téléchargement), `clearHistory`, `GenerateSettings` |
| `src/logger.ts` | `Logger`, `silentLogger` |
| `src/workflow.ts` | types du graphe API, `Aspect`, `Sampler`, `Scheduler`, `LoRA` |
| `src/models/*.ts` | un fichier par modèle : défauts, options, graphe, fonction `generate…` |

Le graphe reprend le workflow UI `image_qwen_image_2_1_t2i_001_simple`. `POST /prompt` reçoit les textes dans `inputs.prompt` et `inputs.negative_prompt` du nœud `TextEncodeQwenImage21`.

## Prérequis

- [Bun](https://bun.sh)
- ComfyUI joignable, par défaut `http://127.0.0.1:8188`
- Ces fichiers déjà présents côté serveur :
  - UNET `qwen_image_2.1_int8_convrot.safetensors`
  - CLIP `qwen3vl_8b_int8_convrot.safetensors`
  - VAE `qwen_image_2.1_vae_bf16.safetensors`

Le budget de pixels est fixé à 1 mégapixel. `cfg` et `denoise` du `KSampler` restent à `1`.

## Dépendance

```json
{
  "dependencies": {
    "comfyui-client": "file:../client-ts"
  }
}
```

`package.json` expose `"."` vers `src/index.ts`. Un autre projet Bun importe depuis `"comfyui-client"`. `client-ts-example` montre cet appel.

## Générer une image

```ts
import {
  Aspect,
  generateQwenImage,
  Sampler,
  Scheduler,
  type GenerateSettings,
  type QwenImageOptions,
} from "comfyui-client";

const options: QwenImageOptions = {
  prompt: "an old dog running in a grass field, daylight",
  negativePrompt: "blur,bad quality",
  unetName: "qwen_image_2.1_int8_convrot.safetensors",
  aspectRatio: Aspect.Standard,
  samplerName: Sampler.Euler,
  seed: 0,
  steps: 25,
  scheduler: Scheduler.Simple,
};

const settings: GenerateSettings = {
  server: "http://127.0.0.1:8188",
  outputDir: "/tmp/comfy/out",
  deleteFromServer: true,
};

const paths = await generateQwenImage(options, settings);
```

`generateQwenImage` envoie le graphe, interroge `GET /history/{prompt_id}` toutes les 2 secondes (timeout 30 minutes), télécharge les images via `GET /view`, et renvoie les chemins locaux.

`QwenImageOptions` porte le prompt et les réglages d'image. `GenerateSettings` porte ce qui ne dépend pas du modèle ; tous les `generate…` le prennent en second argument.

| Champ | Défaut |
| --- | --- |
| `server` | `http://127.0.0.1:8188` |
| `outputDir` | `client-ts/output` |
| `deleteFromServer` | absent : l'historique et la file restent |
| `logger` | `silentLogger` : rien n'est affiché |
| `meta` | absent |

`Aspect`, `Sampler` et `Scheduler` sont des objets de littéraux. `Sampler.Euler` vaut `"euler"`. ComfyUI reçoit cette chaîne.

`deleteFromServer` retire le prompt de l'historique (`POST /history`) puis de la file (`POST /queue`), avec `{ delete: [promptId] }`. Le fichier dans le dossier `output` du serveur n'est pas effacé.

## Suivi et métadonnées

`logger` reçoit la mise en file, la progression (toutes les 15 s), la fin, chaque fichier enregistré et le retrait du serveur. `Logger` a les signatures de `console` (`debug`, `log`, `warn`, `error`), qui peut donc être passé tel quel :

```ts
await generateQwenImage(options, { ...settings, logger: console });
```

`meta` s'ajoute au `_meta` d'un nœud du graphe (l'UNET pour Qwen, Krea 2 et MiniMax Music 3, l'image d'entrée pour Wan 2.2). ComfyUI recopie le graphe dans le chunk `prompt` des fichiers produits, où `readPngMetadata` le relit : c'est un moyen de faire passer des informations d'une étape à l'autre d'un workflow. Les fonctions `build…Prompt` prennent le même objet en second argument.

## Vider l'historique

```ts
import { clearHistory } from "comfyui-client";

await clearHistory("http://127.0.0.1:8188");
```

`clearHistory` envoie `POST /history` avec `{ clear: true }`. Seuls les prompts terminés partent. La file en attente et le prompt en cours restent. Ce n'est pas une option de `generateQwenImage` : un appel groupé effacerait l'historique des autres générations encore en cours.

## Ligne de commande

Depuis `client-ts` :

```sh
bun generate --prompt "a young cat walking on a table, daylight" --negative "blur,bad quality"
```

| Option | Environnement | Défaut |
| --- | --- | --- |
| `--prompt` | `PROMPT` | `a young cat walking on a table, daylight` |
| `--negative` | `NEGATIVE_PROMPT` | `blur,bad quality` |
| `--server` | `COMFY_URL` | `http://127.0.0.1:8188` |
| `--unet` | | `qwen_image_2.1_int8_convrot.safetensors` |
| `--aspect` | | `4:3 (Standard)` |
| `--sampler` | | `euler` |
| `--seed` | | `0` |
| `--steps` | | `25` (entier ≥ 1) |
| `--scheduler` | | `simple` |

`--aspect`, `--sampler` et `--scheduler` n'acceptent que les valeurs exportées (`ASPECT_RATIOS`, `SAMPLER_NAMES`, `SCHEDULER_NAMES`).

`bun example` lance `src/example.ts` : le même appel, avec les options écrites dans le programme.

## Krea 2

`buildKrea2Prompt` reprend le workflow UI `krea2_safetensor`. Le prompt et le négatif partent dans `inputs.text` de deux nœuds `CLIPTextEncode`. Le CLIP est chargé avec `type: "krea2"`.

Fichiers côté serveur :

- UNET `museByStableYogi_v35Int8Extended.safetensors`
- CLIP `qwen3vl_4b_fp8_scaled.safetensors`
- VAE `qwen_image_vae.safetensors`

```ts
import {
  generateKrea2,
  KREA2_DEFAULTS,
  Sampler,
  Scheduler,
  type GenerateSettings,
  type Krea2Options,
} from "comfyui-client";

const options: Krea2Options = {
  prompt: "a small orange cat sleeping on a worn beige carpet",
  negativePrompt: "",
  unetName: KREA2_DEFAULTS.unetName,
  width: KREA2_DEFAULTS.width,
  height: KREA2_DEFAULTS.height,
  samplerName: Sampler.Euler,
  seed: KREA2_DEFAULTS.seed,
  steps: KREA2_DEFAULTS.steps,
  cfg: KREA2_DEFAULTS.cfg,
  scheduler: Scheduler.Simple,
  loras: [],
  batchSize: KREA2_DEFAULTS.batchSize,
};

const settings: GenerateSettings = {
  server: "http://127.0.0.1:8188",
  outputDir: "/tmp/comfy/out",
  deleteFromServer: true,
};

const paths = await generateKrea2(options, settings);
```

| Champ | Défaut |
| --- | --- |
| `unetName` | `museByStableYogi_v35Int8Extended.safetensors` |
| `width` × `height` | 960 × 1472 |
| `samplerName` | `euler` |
| `seed` | `42` |
| `steps` | `16` |
| `cfg` | `1.5` |
| `scheduler` | `simple` |

`denoise` reste à `1`. Le préfixe des fichiers enregistrés est `Krea2`.

`loras` (`LoRA[]` : `model`, `weight`) ajoute des `LoraLoaderModelOnly` entre l'UNET et le `KSampler`, dans l'ordre du tableau.

## Krea 2 avec image de référence

`buildKrea2EditPrompt` reprend le workflow `krea2_identity_edit` du paquet de nœuds [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit). La LoRA Identity Edit replace la personne de l'image de référence dans la scène décrite par la consigne. Le graphe d'origine, exporté depuis l'interface, est `docs/workflow_krea2_identity_edit_mei_laughing.json` ; un test vérifie que le graphe produit est le même.

À installer côté serveur, en plus des fichiers Krea 2 :

- le paquet `comfyui-krea2edit` dans `ComfyUI/custom_nodes`. Sans lui, ComfyUI refuse le graphe (`Krea2EditModelPatch` inconnu) ;
- la LoRA `krea2_identity_edit_v1_2_r128.safetensors` ([conradlocke/krea2-identity-edit](https://huggingface.co/conradlocke/krea2-identity-edit), *Krea 2 Community License*) dans `models/loras`. Sans cette LoRA, Krea 2 ne tient pas compte de la référence.

`generateKrea2Edit` envoie d'abord l'image locale `referenceImage` avec `uploadImage` (`POST /upload/image`), puis le graphe :

```ts
import { generateKrea2Edit, KREA2_EDIT_DEFAULTS } from "comfyui-client";

const paths = await generateKrea2Edit({
  ...KREA2_EDIT_DEFAULTS,
  prompt: "Place this person in a small café at night, wearing a dark green wool coat, medium shot.",
  negativePrompt: "",
  referenceImage: "/data/refs/portrait.png",
});
```

Les champs de `Krea2Options` sont repris. Ceux qui s'ajoutent :

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `referenceImage` | — | `LoadImage` : chemin local pour `generateKrea2Edit`, nom côté serveur pour `buildKrea2EditPrompt` |
| `editLora` | `krea2_identity_edit_v1_2_r128.safetensors`, poids `1` | `LoraLoaderModelOnly`, appliquée avant `loras` |
| `refBoost` | `4` | `Krea2EditModelPatch.ref_boost` : >1 tire vers la référence, <1 laisse plus de liberté |
| `groundingPx` | `768` | `Krea2EditGroundedEncode.grounding_px` : plus haut = plus de ressemblance, plus bas = consigne mieux suivie |
| `fitMode` | `FitMode.Fit` | `Krea2EditModelPatch.fit_mode` |

La consigne est une instruction d'édition. Ce qu'elle ne mentionne pas (tenue, accessoires, fond, cadrage, lumière) est repris de la référence. `negativePrompt` part dans un second `Krea2EditGroundedEncode` sur la même image ; il ne compte qu'à `cfg` > 1 et le paquet le laisse vide. Le préfixe des fichiers enregistrés est `Krea2Edit`.

`uploadImage(path, settings)` renvoie la valeur à mettre dans `LoadImage.inputs.image`. Si un fichier identique existe déjà dans `input/`, ComfyUI le réutilise. S'il existe un fichier différent sous le même nom, ComfyUI enregistre la nouvelle image sous `nom (1).png`.

## Wan 2.2 image → vidéo

`buildWan22Prompt` reprend le workflow UI Wan 2.2 i2v 14B fp8 : UNET high noise jusqu'au pas 10, puis low noise jusqu'au pas 20, cfg 3.5, euler / simple, sans la LoRA lightx2v 4 pas. La vidéo dure 5 s. Ces réglages sont fixes ; seuls ceux de `Wan22Options` changent :

| Champ | Nœud |
| --- | --- |
| `inputImage` | `LoadImage` : nom côté serveur, tel que le renvoie `uploadImage` |
| `prompt` | `CLIPTextEncode` positif |
| `width` × `height` | `WanImageToVideo` |
| `seed` | premier `KSamplerAdvanced` |
| `fps` | `CreateVideo` ; `floor(5 × fps + 1)` images |

```ts
import { generateWan22, uploadImage } from "comfyui-client";

const inputImage = await uploadImage("/data/refs/start.png", settings);
const paths = await generateWan22({ inputImage, prompt: "the cat turns its head", width: 640, height: 640, seed: 0, fps: 16 }, settings);
```

Fichiers côté serveur : UNET `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` et `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`, CLIP `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, VAE `wan_2.1_vae.safetensors`.

## MiniMax Music 3

`buildMiniMaxMusic3Prompt` reprend le workflow UI `audio_minimax_music_3` (`docs/workflow_audio_minimax_music_3.json` ; un test vérifie que le graphe produit est le même). `MiniMaxMusic3TextEncode` reçoit la description et les paroles et renvoie la durée réelle du morceau, qui dimensionne le latent. `KSampler` euler / simple, négatif à zéro, décodage VAE par tuiles, fichier mp3 V0 (préfixe `audio/audio_minimax_music3`).

```ts
import { generateMiniMaxMusic3, MINIMAX_MUSIC3_DEFAULTS } from "comfyui-client";

const paths = await generateMiniMaxMusic3({
  ...MINIMAX_MUSIC3_DEFAULTS,
  caption: "Global Metadata\n…\n\nVocal Details\n…\n\nArrangement\n…",
  lyrics: "[Verse]\n…\n\n[Chorus]\n…",
}, settings);
```

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `caption` | — | `MiniMaxMusic3TextEncode.caption` : sections `Global Metadata`, `Vocal Details`, `Arrangement` |
| `lyrics` | — | `MiniMaxMusic3TextEncode.lyrics` : paroles balisées (`[Verse]`, `[Chorus]`, `[Instrumental]`…) ; vide pour un instrumental |
| `seed` | `0` | `SeedNode`, partagé par l'encodeur et le `KSampler` |
| `maxDuration` | `60` | `max_duration` en secondes (≤ 360) ; le modèle peut finir avant |
| `steps` | `30` | `KSampler` |
| `cfg` | `1.7` | `KSampler` |
| `cfgScale` | `1.7` | `MiniMaxMusic3TextEncode.cfg_scale` |
| `topK` | `50` | `MiniMaxMusic3TextEncode.top_k` |

Le skill `docs/MiniMax-Music3-main/skills/music-caption-rewriter` explique comment écrire la description à partir des modèles par style. `bun example:music` lance `src/example-music.ts`, un morceau orchestral épique écrit d'après `index-cinematic-orchestral-epic.md`.

Fichiers côté serveur ([Comfy-Org/MiniMax-Music-3](https://huggingface.co/Comfy-Org/MiniMax-Music-3)) : UNET `minimax_music3_dit_fp16.safetensors`, CLIP `minimax_music3_text_encoder_pruned_int8_convrot.safetensors` (type `minimax`), VAE `minimax_music3_dav.safetensors`.

### Générer une playlist

`bun batch-music <playlist.json>` génère les morceaux d'une playlist l'un après l'autre et en garde autant par piste qu'il y a de `seeds`. Les fichiers s'appellent `<id>_s<graine>.mp3`, dans `output/music/<nom de la playlist>/` par défaut. La génération avance tour par tour : chaque piste reçoit son premier morceau, puis son deuxième, etc. ; les premiers fichiers couvrent donc tous les styles.

- **Durée minimale** : un morceau plus court que `minDuration` part dans `rejected/`, et la graine suivante est essayée, `retries` fois au plus (2 par défaut). Après les `seeds` de la playlist, les graines continuent à partir de la plus grande déjà vue.
- **Plafond** : un morceau qui atteint `maxDuration` est gardé, mais signalé, car sa fin est sans doute coupée.
- **Volume** : chaque morceau gardé est égalisé à `loudness` LUFS (−16 par défaut, crête à −1,5 dBTP) par deux passages `ffmpeg loudnorm`, puis réencodé en mp3 V0. Les métadonnées, dont le graphe ComfyUI, sont gardées. `"loudness": null` laisse le fichier tel quel.
- **Reprise** : un fichier déjà présent, gardé ou rejeté, n'est pas refait. Une génération interrompue reprend où elle s'est arrêtée.
- **Échecs** : un échec est noté et la suite continue avec la piste suivante.
- **Rapport** : chaque essai ajoute une ligne à `report.tsv` : fichier, graine, durée, `ok` / `short` / `cut`, temps de calcul en secondes.

Il faut `ffmpeg` et `ffprobe` dans le `PATH`.

```sh
bun batch-music playlists/focus.json --dry-run
bun batch-music playlists/focus.json --only lofi-rain,jazz-trio --count 5
```

| Option | Défaut |
| --- | --- |
| `--out` | `output/music/<nom>` |
| `--only` | toutes les pistes |
| `--count` | nombre de `seeds` de la playlist : morceaux à garder par piste |
| `--server` | `COMFY_URL`, sinon `http://127.0.0.1:8188` |
| `--dry-run` | liste ce qui reste à générer |

```json
{
  "seeds": [1, 2, 3],
  "lyrics": "[Instrumental]",
  "options": { "maxDuration": 240 },
  "minDuration": 90,
  "retries": 2,
  "loudness": -16,
  "tracks": [
    { "id": "lofi-rain", "caption": "Global Metadata\n…" },
    { "id": "piano", "caption": "…", "lyrics": "…", "options": { "steps": 20 } }
  ]
}
```

`options` reprend les champs de `MiniMaxMusic3Options` sauf `caption`, `lyrics` et `seed`. Une piste peut remplacer `lyrics` et `options`. `meta` reçoit `playlist`, `track` et `seed`.

`playlists/focus.json` : 12 styles instrumentaux pour travailler (lo-fi, ambient, piano néo-classique, trio jazz, downtempo, synthwave, post-rock, guitare acoustique, deep house minimale, bossa nova, electronica, kalimba), 3 morceaux par piste, entre 90 et 240 s.

Le modèle décide seul où le morceau s'arrête ; `maxDuration` n'est qu'un plafond. Pour un instrumental, la durée suit surtout le nombre de balises dans les paroles. Mesures sur la piste `lofi-rain` : paroles vides, environ 28 s ; `[Instrumental]` seul, 26 à 50 s ; 10 balises, 87 à 120 s ; 22 balises (celles de `focus.json`), 61, 148 et 162 s selon la graine. Annoncer « trois minutes » dans la description ne change rien.

`runGraph` lit les fichiers rangés sous `images` (images et vidéos) et sous `audio` dans l'historique.

Voir le skill de MiniMax : https://github.com/MiniMax-AI/MiniMax-Music3/blob/main/skills/music-caption-rewriter/SKILL.md

## Lire le graphe dans un PNG

ComfyUI écrit le graphe dans le PNG : `prompt` est le graphe API, `workflow` est le graphe de l'interface. `workflow` manque quand l'image a été produite par l'API sans `extra_pnginfo`.

```ts
import { readPngMetadataFile } from "comfyui-client";

const { prompt, workflow } = await readPngMetadataFile("/tmp/comfy/out/image.png");
```

`readPngMetadata` prend les octets du fichier. Les chunks `tEXt`, `zTXt`, `iTXt` et `comf` sont lus. Un chunk absent vaut `null`.

## Tests

```sh
bun test
```
