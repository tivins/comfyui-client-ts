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

## Tests

```sh
bun test
```
