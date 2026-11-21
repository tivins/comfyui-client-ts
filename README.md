# comfyui-client

Client Bun qui envoie des graphes API (Qwen Image 2.1, Krea 2, FLUX 3 Image Klein, MiniMax H3 Image, Wan 2.2, MiniMax H3, MiniMax Music 3, SeedVR2) à un serveur ComfyUI, attend la fin du prompt, et enregistre les fichiers produits en local.

| Fichier | Contenu |
| --- | --- |
| `src/client.ts` | `runGraph` (envoi, attente, téléchargement), `clearHistory`, `GenerateSettings` |
| `src/logger.ts` | `Logger`, `silentLogger` |
| `src/progress.ts` | `GenerationProgress`, écoute du WebSocket `/ws` pour `onProgress` |
| `src/workflow.ts` | types du graphe API, `Aspect`, `Sampler`, `Scheduler`, `LoRA` |
| `src/models/*.ts` | un fichier par modèle : défauts, options, graphe, fonction `generate…` |
| `workflows/*.json` | graphes exportés de l'interface, que les tests comparent aux graphes produits |

Le graphe reprend le workflow UI `image_qwen_image_2_1_t2i_001_simple`. `POST /prompt` reçoit les textes dans `inputs.prompt` et `inputs.negative_prompt` du nœud `TextEncodeQwenImage21`.

## Prérequis

- [Bun](https://bun.sh)
- ComfyUI joignable, par défaut `http://127.0.0.1:8188`
- Ces fichiers déjà présents côté serveur :
  - UNET `qwen_image_2.1_int8_convrot.safetensors`
  - CLIP `qwen3vl_8b_int8_convrot.safetensors`
  - VAE `qwen_image_2.1_vae_bf16.safetensors`
- Pour `deleteFromServer` : le custom node `comfyui-delete-output` installé dans ComfyUI (voir [Effacer du serveur](#effacer-du-serveur))

Le budget de pixels est fixé à 1 mégapixel. `cfg` et `denoise` du `KSampler` restent à `1`.

## Dépendance

Par git, figé sur une version (un tag `v<version>` par version publiée dans le CHANGELOG) :

```json
{
  "dependencies": {
    "comfyui-client": "github:tivins/comfyui-client-ts#v0.26.1"
  }
}
```

Sur la même machine, par chemin : `"comfyui-client": "file:../comfyui-client-ts"`.

`package.json` expose `"."` vers `src/index.ts`. Un autre projet Bun importe depuis `"comfyui-client"`. `src/example.ts` montre un appel complet.

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
| `deleteFromServer` | absent : les fichiers, l'historique et la file restent |
| `logger` | `silentLogger` : rien n'est affiché |
| `meta` | absent |
| `onProgress` | absent : pas de WebSocket, la fin est lue dans `/history` toutes les 2 s |

`Aspect`, `Sampler` et `Scheduler` sont des objets de littéraux. `Sampler.Euler` vaut `"euler"`. ComfyUI reçoit cette chaîne.

### Effacer du serveur

`deleteFromServer` efface les fichiers produits du dossier `output` du serveur (`POST /api/output/delete`), puis retire le prompt de l'historique (`POST /history`) et de la file (`POST /queue`), avec `{ delete: [promptId] }`. Seuls les fichiers `type: "output"` sont effacés : ceux de `temp` restent, ComfyUI vide ce dossier au démarrage.

ComfyUI n'a pas de route pour effacer un fichier. `POST /api/output/delete` vient du custom node `comfyui-delete-output` (pas encore publié), à placer dans `ComfyUI/custom_nodes/`.

Puis redémarrer ComfyUI. Sans le custom node, ComfyUI répond 404 ou 405 : les fichiers restent, `logger.warn` le signale, et l'historique est retiré comme avant. Une autre erreur (chemin hors du dossier `output`, fichier impossible à effacer) lève une exception, et l'historique reste.

ComfyUI garde en cache le résultat du dernier graphe. Relancer un graphe identique (même graine, mêmes entrées) ne réexécute pas `SaveImage` : l'historique renvoie le fichier déjà produit. Si `deleteFromServer` l'a effacé, `GET /view` répond 404 et `runGraph` lève une erreur qui le dit. Changer la graine ou une autre entrée relance le graphe.

## Suivi et métadonnées

`logger` reçoit la mise en file, la progression (toutes les 15 s), la fin, chaque fichier enregistré et le retrait du serveur. `Logger` a les signatures de `console` (`debug`, `log`, `warn`, `error`), qui peut donc être passé tel quel :

```ts
await generateQwenImage(options, { ...settings, logger: console });
```

`onProgress` reçoit l'avancement en direct. `runGraph` ouvre le WebSocket `/ws?clientId=…` de ComfyUI avant `POST /prompt` (qui reçoit le même `client_id`), et appelle le callback à chaque début de nœud et à chaque pas :

```ts
await generateWan22(options, {
  ...settings,
  onProgress: ({ classType, step, nodesDone, nodesTotal }) =>
    console.log(`${classType} ${step ? `${step.value}/${step.max}` : ""} (nœud ${nodesDone + 1}/${nodesTotal})`),
});
```

`GenerationProgress` porte `promptId`, `node` (id du graphe API), `classType`, `nodesDone`, `nodesTotal` et `step` (`{ value, max }`, ou `null`). `nodesTotal` est un maximum : les nœuds repris du cache en sont retirés, mais la branche non prise d'un interrupteur (`ComfySwitchNode`) ne s'exécute pas, et `nodesDone` n'atteint alors jamais le total (Wan 2.2 : 26 sur 32). Les pas mesurent mieux l'avancement. Ils sont donnés par nœud : Wan 2.2 et ses deux samplers donnent deux séries 1→N. Les nœuds sans pas n'envoient que leur début ; le chargement d'un modèle se fait souvent au début du sampler, avant son premier pas (Wan 2.2 : environ 50 s sans message à chaque sampler). Le WebSocket signale aussi la fin, ce qui évite d'attendre le prochain passage sur `/history`. S'il est injoignable, `logger.warn` le signale et la génération se fait sans suivi. Le logger ajoute le dernier avancement à son message « en cours ». Les aperçus (messages binaires, avec `--preview-method`) sont ignorés.

`meta` s'ajoute au `_meta` d'un nœud du graphe (l'UNET pour Qwen, Krea 2 et MiniMax Music 3, l'image d'entrée pour Wan 2.2 et MiniMax H3). ComfyUI recopie le graphe dans le chunk `prompt` des fichiers produits, où `readPngMetadata` (images) et `readMp3Metadata` (morceaux) le relisent : c'est un moyen de faire passer des informations d'une étape à l'autre d'un workflow. Les fonctions `build…Prompt` prennent le même objet en second argument.

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

`buildKrea2EditPrompt` reprend le workflow `krea2_identity_edit` du paquet de nœuds [comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit). La LoRA Identity Edit replace la personne de l'image de référence dans la scène décrite par la consigne. Le graphe d'origine, exporté depuis l'interface, est `workflows/workflow_krea2_identity_edit_mei_laughing.json` ; un test vérifie que le graphe produit est le même.

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
  referenceImage: "refs/portrait.png",
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

## FLUX 3 Image Klein

`buildFlux3KleinPrompt` reprend le sous-graphe « Multiple image to image (FLUX 3 Klein) » des workflows `flux3_klein_int8_mi2i` et `flux3_klein_int8_t2i` du dépôt [black-forest-labs/flux-3-image-klein-comfy](https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy), sans le prompt upsampler ni les boîtes de placement. Un seul modèle (5,6B, distillé, 16 pas, cfg fixé à 1) fait le texte vers image et l'édition avec **0 à 10 images de référence**. Le prompt les nomme dans l'ordre : « the man from the first image », « the woman from the second image ». Sans référence, `ReferenceMultiLatent` est retiré du graphe.

```ts
import { generateFlux3Klein, FLUX3_KLEIN_DEFAULTS } from "comfyui-client";

const paths = await generateFlux3Klein({
  ...FLUX3_KLEIN_DEFAULTS,
  prompt: "A 3D animated scene: the man from the first image and the old woman from the second image play chess in a park.",
  referenceImages: ["refs/man.png", "refs/woman.png"],
  width: 1280,
  height: 720,
});
```

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `referenceImages` | — | un `LoadImage` par image, sur `ReferenceMultiLatent.images.image0…` ; chemins locaux pour `generateFlux3Klein` (envoyés avec `uploadImage`), noms côté serveur pour `buildFlux3KleinPrompt` |
| `referenceMegapixels` | `1` | `ReferenceMultiLatent` : taille de chaque référence, proportions gardées |
| `width` × `height` | 1024 × 1024 | `EmptyFlux2LatentImage`, multiples de 16 |
| `steps` | `16` | `KSampler` (4 à 16 pour le distillé, 50 pour le modèle de base) |
| `alpha` | `16` | `ModelSamplingFlux` : shift = ln(alpha) |
| `seed`, `samplerName`, `scheduler`, `batchSize` | 42, euler, simple, 1 | `KSampler`, `EmptyFlux2LatentImage` |
| `unetName`, `clipName`, `vaeName` | fichiers ci-dessous | loaders ; CLIP chargé en type `flux3` |

Fichiers côté serveur (dépôt gated, *FLUX Kommunity License* : usage commercial gratuit sous 5 M$ de chiffre d'affaires ; script `download_flux3_klein.sh` du dépôt comfyui) : UNET `flux3-image-klein-int8-convrot.safetensors`, CLIP `qwen3vl_4b_int8_convrot.safetensors`, VAE `flux2-vae.safetensors`. Demande ComfyUI 0.41.0 ou plus. Le préfixe des fichiers enregistrés est `Flux3Klein`.

Sur une RTX 5060 Ti : environ 12 s pour 1 Mpx sans référence, 15 s avec une référence, 24 s en 1280 × 720 avec deux. Comparé à Krea 2 Identity Edit sur des portraits style Pixar : cadrage et consigne mieux suivis, mais caricatures moins belles et personnages qui semblent collés sur le fond.

## MiniMax H3 Image

`buildMiniMaxH3ImagePrompt` reprend les modèles de workflow « MiniMax-H3-Image: Text to Image » et « Image Edit » de ComfyUI (`image_minimax_h3_image_t2i`, `image_minimax_h3_image_edit`), sans le prompt enhancer ni le redimensionnement des images en amont. Un seul nœud, `MiniMaxH3ImageConditioning`, fait le texte vers image et l'édition avec **0 à 100 images** : il encode le prompt avec Qwen3-VL 32B (l'encodeur de MiniMax H3 vidéo), voit les images, les ancre en latents de référence avec le VAE et fournit le latent vide. Le prompt les nomme `<Picture 1>`, `<Picture 2>`… ; `<Picture 1>` est l'image à éditer. Le `KSampler` tourne en 6 pas, cfg 1, avec le conditionnement mis à zéro en négatif.

```ts
import { generateMiniMaxH3Image, MINIMAX_H3_IMAGE_DEFAULTS } from "comfyui-client";

const paths = await generateMiniMaxH3Image({
  ...MINIMAX_H3_IMAGE_DEFAULTS,
  prompt: "Put a small knitted red scarf around the neck of the cat in <Picture 1> and make it snow gently in the garden.",
  referenceImages: ["refs/cat.png"],
});
```

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `referenceImages` | `[]` | un `LoadImage` par image, sur `MiniMaxH3ImageConditioning.images.image_1…` ; chemins locaux pour `generateMiniMaxH3Image` (envoyés avec `uploadImage`), noms côté serveur pour `buildMiniMaxH3ImagePrompt`. Le nœud les met à l'échelle : côté court entre 1024 et 2048 |
| `width` × `height` | 0 × 0 | `MiniMaxH3ImageConditioning`, multiples de 32. 0 : 2048² sans image, sinon la taille de la première image après mise à l'échelle |
| `steps` | `6` | `KSampler` |
| `seed`, `samplerName`, `scheduler` | 42, euler, simple | `KSampler` |
| `unetName`, `clipName`, `vaeName` | fichiers ci-dessous | loaders ; CLIP chargé en type `minimax` |

Le modèle est réglé pour 2048² (4 Mpx), rend mal en dessous et va jusqu'à ~20 Mpx (16 Mpx conseillés : 4096², 4736 × 3552, 5472 × 3072…). En édition avec `width` et `height` à 0, une petite image donne une petite sortie (960 × 1472 → 1024 × 1568) : donner la taille voulue, ou agrandir l'image avant.

Fichiers côté serveur (script `download_minimax_h3_image.sh` du dépôt comfyui) : UNET `minimax_h3_image_pruned_w4a8.safetensors` (12,5 Go, `MiniMaxH3ImageModel.W4a8`), CLIP `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` (celui de MiniMax H3 vidéo), VAE `minimax_h3_image_vae_fp16.safetensors`. Les modèles de workflow prennent l'int8 (`MiniMaxH3ImageModel.Int8`, 21 Go, `download_minimax_h3_image.sh int8`). Demande ComfyUI 0.45.0 ou plus. Licence MiniMax propre au modèle : autorisation à demander au-delà de 1 M$ de revenu annuel ou pour un service hébergé ouvert à des tiers. Le préfixe des fichiers enregistrés est `MiniMaxH3Image`.

Sur une RTX 5060 Ti, modèles froids : 27 s pour 2048² sans image (15,5 Go de VRAM), 34 s pour une édition en 1024 × 1568.

## Wan 2.2 image → vidéo

`buildWan22Prompt` reprend le workflow UI Wan 2.2 i2v 14B fp8 : UNET high noise jusqu'à `splitStep`, puis low noise jusqu'à `steps`, euler / simple. `WAN22_DEFAULTS` garde les valeurs du workflow : 20 pas coupés au pas 10, cfg 3.5, 5 s à 16 images/s, négatif d'origine. `lightning: true` allume la LoRA lightx2v 4 pas sur les deux UNET (4 pas coupés au pas 2, cfg 1) : `steps`, `splitStep` et `cfg` sont alors ignorés.

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `inputImage` | | `LoadImage` ; pour `generateWan22`, un chemin local envoyé avec `uploadImage` |
| `prompt`, `negativePrompt` | négatif du workflow | `CLIPTextEncode` positif et négatif |
| `width` × `height` | 640 × 640 | `WanImageToVideo`, qui y met l'image de départ (bilinéaire, recadrée au centre) |
| `seed` | 42 | premier `KSamplerAdvanced` |
| `fps`, `duration` | 16, 5 | `CreateVideo` ; `floor(duration × fps + 1)` images |
| `steps`, `splitStep`, `cfg` | 20, 10, 3.5 | `KSamplerAdvanced` (sans `lightning`) |
| `lightning` | `false` | interrupteur `Enable 4steps LoRA?` |

Le redimensionnement de `WanImageToVideo` n'a pas d'anti-aliasing : une grande image réduite d'un coup donne du crénelage. Mieux vaut envoyer une image déjà à la taille de la vidéo, au même ratio.

```ts
import { generateWan22, WAN22_DEFAULTS } from "comfyui-client";

const paths = await generateWan22({ ...WAN22_DEFAULTS, inputImage: "refs/start.png", prompt: "the cat turns its head", lightning: true }, settings);
```

Fichiers côté serveur : UNET `wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors` et `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`, CLIP `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, VAE `wan_2.1_vae.safetensors`, LoRA `wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors` et `…_low_noise.safetensors` (pour `lightning`).

## MiniMax H3 image → vidéo

`buildMiniMaxH3Prompt` reprend le modèle de workflow « MiniMax H3 Image to Video » (`video_minimax_h3_i2v`), sous-graphe déplié. MiniMax H3 (33 milliards de paramètres) produit la vidéo et son son stéréo 32 kHz (voix, bruitages, musique) en une passe : `MiniMaxH3ImageToVideo` encode le prompt avec Qwen3-VL 32B et l'image de départ, `SamplerCustomAdvanced` échantillonne en `res_multistep` / `simple` sans CFG, puis le latent est décodé par le VAE vidéo et par le VAE audio, et `CreateVideo` les réunit à 24 images/s. Le prompt désigne l'image de départ par `<Picture 1>` ; une ligne `Audio:` décrit le son.

`generateMiniMaxH3` envoie d'abord l'image de départ (et la dernière, s'il y en a une) avec `uploadImage` :

```ts
import { generateMiniMaxH3, MINIMAX_H3_DEFAULTS } from "comfyui-client";

const paths = await generateMiniMaxH3({
  ...MINIMAX_H3_DEFAULTS,
  inputImage: "refs/kitten.png",
  prompt: "The tabby kitten from <Picture 1> bats the yarn ball with its paw. Static camera.\nAudio: quiet room tone, soft paw taps, a tiny meow.",
}, settings);
```

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `inputImage` | | `LoadImage` (114) ; pour `generateMiniMaxH3`, un chemin local envoyé avec `uploadImage` |
| `lastImage` | `null` | `LoadImage` (117) relié à `last_frame`, même convention ; recadrée au centre |
| `prompt` | | `MiniMaxH3ImageToVideo` |
| `width` × `height` | 768 × 768 | `MiniMaxH3ImageToVideo`, multiples de 32 ; l'image de départ y est étirée sans garder son ratio |
| `seed` | 42 | `RandomNoise` |
| `duration` | 5 | `round(duration × 24)` images, arrondi au-dessus à 17k + 5 : 5 s → 124 images (`minimaxH3FrameCount`) |
| `steps` | 20 | `BasicScheduler` (sans `turbo`) |
| `turbo` | `false` | LoRA Turbo 8 pas v1.1 768p, 8 pas : `steps` est ignoré |
| `loras` | `[]` | `LoraLoaderModelOnly` enchaînés après la diffusion (et après la LoRA Turbo avec `turbo`), `{ model, weight }` : LoRA entraînées pour MiniMax H3 seulement, fichiers de `models/loras/`. Avec la diffusion NVFP4, toute LoRA casse le mouvement, même à 0,01 (poids recompressés en 4 bits) ; pas essayé en int8 |
| `unetName` | `MiniMaxH3Model.Nvfp4` | `UNETLoader` ; `MiniMaxH3Model.Int8` est celui du modèle de workflow |
| `saveLastFrame` | `true` | `ImageFromBatch` (93, index -1) sur la sortie du VAE, puis `SaveImage` (94, préfixe `video/MiniMax_H3_last`) : la dernière image en PNG, sans la compression H.264 du mp4. C'est elle qu'il faut reprendre pour enchaîner une vidéo sur la fin de celle-ci. `false` : le graphe du modèle de workflow |

`generateMiniMaxH3` renvoie la vidéo d'abord, puis le PNG de sa dernière image avec `saveLastFrame` (`videoFirst` trie les fichiers dans cet ordre).

Mesures sur une RTX 5060 Ti 16 Go, diffusion NVFP4, même image et même graine, 5 s (124 images) :

| Taille | Réglage | Durée | Rendu |
| --- | --- | --- | --- |
| 640 × 640 | 20 pas | 254 s (12,2 s/pas) | bon |
| 768 × 768 | 20 pas | 478 s (23,2 s/pas) | le meilleur |
| 640 × 640 | Turbo v1.0, 8 pas | 144 s | détails brouillés |
| 768 × 768 | Turbo v1.0, 8 pas | 216 s | détails brouillés |
| 768 × 768 | Turbo v1.1 768p, 8 pas | 213 s | détails brouillés |

Avec le Turbo, les détails fins (fils d'une pelote de laine, yeux, pelage) se brouillent au fil de la vidéo ; c'est pourquoi il est éteint par défaut. Il n'a pas été essayé avec la diffusion int8. VRAM au plus 15,8 Go, RAM 10,9 Go, sans swap ; ComfyUI charge les modèles en VRAM dynamique et déborde en RAM si besoin. La première génération compte ~30 s de chargement. Sous 384p, le modèle échoue.

Fichiers côté serveur, téléchargés par `download_minimax_h3.sh` du dépôt comfyui : diffusion `minimax_h3_fl2va_pruned_nvfp4.safetensors` (NVFP4, demande une carte Blackwell ; `download_minimax_h3.sh int8` ajoute `minimax_h3_fl2va_pruned_int8_convrot.safetensors`), CLIP `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`, VAE `minimax_h3_video_vae_int8_convrot.safetensors` et `minimax_h3_audio_vae_fp32.safetensors`, LoRA `minimax_h3_fl2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors` (pour `turbo`). ComfyUI 0.30.0 ou plus. Licence MiniMax H3 Community License : usage commercial permis, avec « MiniMax H3 » affiché dans l'interface du produit.

## MiniMax Music 3

`buildMiniMaxMusic3Prompt` reprend le workflow UI `audio_minimax_music_3` (`workflows/workflow_audio_minimax_music_3.json` ; un test vérifie que le graphe produit est le même). `MiniMaxMusic3TextEncode` reçoit la description et les paroles et renvoie la durée réelle du morceau, qui dimensionne le latent. `KSampler` euler / simple, négatif à zéro, décodage VAE par tuiles, fichier mp3 V0 (préfixe `audio/audio_minimax_music3`).

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

Le skill `docs/MiniMax-Music3-main/skills/music-caption-rewriter` (dans le dépôt comfyui, hors git) explique comment écrire la description à partir des modèles par style. `bun example:music` lance `src/example-music.ts`, un morceau orchestral épique écrit d'après `index-cinematic-orchestral-epic.md`.

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

## Agrandir une image (SeedVR2)

`buildSeedVR2Prompt` reprend le modèle de workflow « Agrandissement d'image : SeedVR2 7B Int8 » (`workflows/workflow_utility_seedvr2_7b_int8_upscale_image.json`, sans le nœud `ImageCompare` de l'interface ; un test vérifie que le graphe produit est le même). L'image est agrandie en lanczos à la taille voulue, puis SeedVR2 la restaure en un seul pas : il recrée le détail fin (poils, cheveux, textures) sans changer le contenu. Encodage et décodage VAE par tuiles.

`generateSeedVR2Upscale` envoie d'abord l'image locale `image` avec `uploadImage`, puis le graphe :

```ts
import { generateSeedVR2Upscale, SEEDVR2_DEFAULTS } from "comfyui-client";

const paths = await generateSeedVR2Upscale({
  ...SEEDVR2_DEFAULTS,
  image: "refs/cat.png",
  resize: { longerSide: 3840 },
});
```

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `image` | — | `LoadImage` : chemin local pour `generateSeedVR2Upscale`, nom côté serveur pour `buildSeedVR2Prompt` |
| `resize` | `{ multiplier: 4 }` | `ResizeImageMaskNode` : `{ multiplier }` agrandit d'un facteur, `{ longerSide }` fixe le grand côté en pixels |
| `colorCorrection` | `ColorCorrection.Lab` | `SeedVR2PostProcessing.color_correction_method` : `lab` (le plus fidèle), `wavelet`, `adain`, `none` (valeur du workflow d'exemple, couleurs un peu plus chaudes) |
| `seed` | `42` | `KSampler` |
| `tileSize`, `tileOverlap` | `512`, `128` | `VAEEncodeTiled` et `VAEDecodeTiled` : plus petit = moins de VRAM |
| `unetName` | `seedvr2_7b_int8_convrot.safetensors` | `UNETLoader` ; `seedvr2_3b_int8_convrot.safetensors` est plus léger |
| `vaeName` | `seedvr2_ema_vae_fp16.safetensors` | `VAELoader` |

Fichiers côté serveur : `download_seedvr2.sh`, dans le dépôt comfyui, les télécharge dans `models/` (8,8 Go). Sur une RTX 5060 Ti 16 Go, un ×4 de 592×448 vers 2368×1792 prend environ 6 s, modèle déjà chargé. Le préfixe des fichiers enregistrés est `SeedVR2`.

## Agrandir une vidéo (SeedVR2)

`buildSeedVR2VideoPrompt` reprend le modèle de workflow « Upscale Video (SeedVR2 3B Int8) » (`workflows/workflow_utility_seedvr2_3b_int8_upscale_video.json`), sous-graphe déplié. C'est la chaîne de l'agrandissement d'image, appliquée à la vidéo : SeedVR2 restaure les images ensemble (par morceaux de `framesPerChunk`), et non une à une. `CreateVideo` remonte ensuite la vidéo avec les images/s, la profondeur et l'audio d'origine. Le `Video Slice` du modèle est retiré : on envoie la vidéo entière. Un test vérifie que le graphe produit est celui du modèle, interrupteurs résolus.

`generateSeedVR2VideoUpscale` envoie d'abord la vidéo locale `video` avec `uploadImage`, puis le graphe :

```ts
import { generateSeedVR2VideoUpscale, SEEDVR2_VIDEO_DEFAULTS } from "comfyui-client";

const paths = await generateSeedVR2VideoUpscale({
  ...SEEDVR2_VIDEO_DEFAULTS,
  video: "videos/wan.mp4",
});
```

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `video` | — | `LoadVideo` : chemin local pour `generateSeedVR2VideoUpscale`, nom côté serveur pour `buildSeedVR2VideoPrompt` |
| `resize` | `{ multiplier: 2 }` | `ResizeImageMaskNode`, comme pour l'image |
| `framesPerChunk` | `33` | `SeedVR2TemporalChunk` en mode manuel : images par morceau (4n + 1), recollés par `SeedVR2TemporalMerge` avec 2 latents (8 images) fondus ; `null` échantillonne d'un bloc |
| `colorCorrection` | `ColorCorrection.Lab` | `SeedVR2PostProcessing.color_correction_method` |
| `seed` | `42` | `KSampler` |
| `tileSize`, `tileOverlap` | `512`, `128` | `VAEEncodeTiled` et `VAEDecodeTiled` (le VAE traite 64 images à la fois, 8 en commun) |
| `unetName` | `seedvr2_7b_int8_convrot.safetensors` | `UNETLoader` ; le modèle de workflow prend le 3B, plus léger, que `download_seedvr2.sh` ne télécharge pas |
| `vaeName` | `seedvr2_ema_vae_fp16.safetensors` | `VAELoader` |

Découpage : la VRAM monte avec le nombre d'images échantillonnées d'un bloc. Le modèle de workflow découpe en mode auto, d'après la VRAM libre, mais sur 16 Go, une fois le 7B chargé, il ne reste que ~7 Gio et le mode auto tombe à une image par morceau, ce qui revient à agrandir image par image. La taille du morceau est donc fixée ici.

Mesures sur une RTX 5060 Ti 16 Go, 7B, vidéo Wan 2.2 de 640 × 640 à 16 images/s en ×2 (1280 × 1280) :

| Images | `framesPerChunk` | Durée | Pic de VRAM |
| --- | --- | --- | --- |
| 17 | `33` (un bloc) | 81 s (modèle à charger) | 11,8 Go |
| 33 | `33` (un bloc) | 151 s | 13,6 Go |
| 81 | `33` (3 morceaux) | 373 s | 13,9 Go |

Le VAE prend presque tout le temps (pour 81 images : encodage 102 s, échantillonnage 21 s, décodage 249 s), soit ~4,5 s par image. `tileSize: 768` gagne ~17 % (33 images : 126 s) pour la même VRAM. D'un bloc, la VRAM monte d'environ 0,11 Go par image : 81 images ne tiendraient pas (~19 Go). Une vidéo interpolée en ×2 (161 images) prendrait ~12 min (non essayé). L'audio, les images/s et la durée sont gardés ; aucune couture visible aux jonctions des morceaux.

Le préfixe des fichiers enregistrés est `SeedVR2Video`.

## Interpoler les images d'une vidéo (RIFE, FILM)

`buildFrameInterpolationPrompt` reprend le modèle de workflow « Frame Interpolation: FILM or RIFE » (`utility_video_frame_interpolation`), sous-graphe déplié. `FrameInterpolate` ajoute `multiplier - 1` images entre chaque paire, et la vidéo est remontée à `fps × multiplier` avec l'audio d'origine : la durée ne change pas. Une vidéo Wan 2.2 de 81 images à 16 images/s donne, en ×2, 161 images à 32 images/s.

`generateFrameInterpolation` envoie d'abord la vidéo locale `video` avec `uploadImage`, puis le graphe :

```ts
import { generateFrameInterpolation, FRAME_INTERPOLATION_DEFAULTS } from "comfyui-client";

const paths = await generateFrameInterpolation({
  ...FRAME_INTERPOLATION_DEFAULTS,
  video: "videos/wan.mp4",
});
```

| Champ | Défaut | Nœud |
| --- | --- | --- |
| `video` | — | `LoadVideo` : chemin local pour `generateFrameInterpolation`, nom côté serveur pour `buildFrameInterpolationPrompt` |
| `modelName` | `rife_v4.26.safetensors` | `FrameInterpolationModelLoader`, qui reconnaît RIFE ou FILM d'après les poids ; `FrameInterpolationModel` liste les fichiers du dépôt Comfy-Org (`Film` : `film_net_fp16.safetensors`) |
| `multiplier` | `2` | `FrameInterpolate`, entier de 2 à 16 ; multiplie aussi les images/s de `CreateVideo` |

Le multiplicateur est entier : 16 images/s donnent 32 ou 48, pas 25.

Sur une RTX 5060 Ti 16 Go, une vidéo Wan 2.2 de 528×784 en ×2 (80 images à créer) : RIFE 4.26 interpole en 1,6 s (4 s pour tout le graphe, +0,4 Go de VRAM), FILM en 9,8 s (12 s, +1,8 Go). Sur cette vidéo (un chaton qui mordille un jouet à plumes), aucun des deux ne laisse d'artefact visible sur les griffes ou les plumes ; FILM est un peu plus net sur les textures fines.

Fichiers côté serveur : `download_frame_interpolation.sh`, dans le dépôt comfyui, télécharge RIFE 4.26 et FILM dans `models/frame_interpolation/` (92 Mo ; `all` ajoute les autres RIFE, 246 Mo en tout), puis déclare le dossier dans `extra_model_paths.yaml` : redémarrer ComfyUI ensuite. Le préfixe des fichiers enregistrés est `FrameInterpolation`.

## Lire le graphe dans un PNG

ComfyUI écrit le graphe dans le PNG : `prompt` est le graphe API, `workflow` est le graphe de l'interface. `workflow` manque quand l'image a été produite par l'API sans `extra_pnginfo`.

```ts
import { readPngMetadataFile } from "comfyui-client";

const { prompt, workflow } = await readPngMetadataFile("/tmp/comfy/out/image.png");
```

`readPngMetadata` prend les octets du fichier. Les chunks `tEXt`, `zTXt`, `iTXt` et `comf` sont lus. Un chunk absent vaut `null`.

## Lire le graphe dans un mp3

ComfyUI écrit les mêmes `prompt` et `workflow` dans le tag ID3v2 du mp3, en frames `TXXX`. L'égalisation de `batch-music` les garde.

```ts
import { readMp3MetadataFile } from "comfyui-client";

const { prompt } = await readMp3MetadataFile("output/music/focus/electronica-glow_s1.mp3");
```

`readMp3MetadataFile` ne lit que le tag, pas l'audio. `readMp3Metadata` prend les octets du fichier. ID3v2.3 et 2.4 sont lus (latin-1, UTF-16, UTF-8, désynchronisation) ; les frames compressées ou chiffrées sont ignorées. Un mp3 sans tag, ou un tag absent, donne `null`.

## Tests

```sh
bun test
```

Vérification des types (`@types/bun` et `typescript` sont en devDependencies, `bun install` les installe) :

```sh
bun run typecheck
```

Le custom node `comfyui-delete-output` a ses propres tests, dans son dépôt.
