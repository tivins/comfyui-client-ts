# comfyui-client

Client Bun qui envoie le graphe API Qwen Image 2.1 à un serveur ComfyUI, attend la fin du prompt, et enregistre les images en local.

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

`QwenImageOptions` porte le prompt et les réglages d'image. `GenerateSettings` porte le serveur et le dossier de sortie.

| Champ | Défaut |
| --- | --- |
| `server` | `http://127.0.0.1:8188` |
| `outputDir` | `client-ts/output` |
| `deleteFromServer` | absent : l'historique et la file restent |

`Aspect`, `Sampler` et `Scheduler` sont des objets de littéraux. `Sampler.Euler` vaut `"euler"`. ComfyUI reçoit cette chaîne.

`deleteFromServer` retire le prompt de l'historique (`POST /history`) puis de la file (`POST /queue`), avec `{ delete: [promptId] }`. Le fichier dans le dossier `output` du serveur n'est pas effacé.

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
