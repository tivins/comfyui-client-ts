# Changelog

## 0.8.1 — 2026-09-29

`README.md` décrit l'installation en dépendance `file:`, l'appel `generateQwenImage`, `clearHistory`, et les options du script `bun generate`.

## 0.8.0 — 2026-09-29

`package.json` expose `"."` vers `src/index.ts`. Un autre projet Bun peut dépendre de `comfyui-client` avec `"file:../client-ts"` et importer `generateQwenImage`, `clearHistory` et les réglages du workflow depuis `"comfyui-client"`. `client-ts-example` montre cet appel.

## 0.7.0 — 2026-09-29

`deleteFromServer` retire l'image de l'historique (`POST /history`) puis le prompt de la file (`POST /queue`), tous deux avec `{ delete: [promptId] }`. `clearHistory` reste l'appel qui vide tout l'historique.

## 0.6.0 — 2026-09-29

`clearHistory` vide l'historique des prompts terminés (`POST /history` avec `{ clear: true }`). La file en attente et le prompt en cours d'exécution ne sont pas touchés. Ce n'est pas une option de `generateQwenImage` : un appel groupé effacerait l'historique des autres générations encore en cours.

## 0.5.0 — 2026-09-29

`GenerateSettings.deleteFromServer` retire le prompt de l'historique ComfyUI (`POST /history`) une fois les images téléchargées. Le fichier dans le dossier `output` du serveur n'est pas effacé : cette version de ComfyUI n'expose pas d'endpoint pour ça.

## 0.4.0 — 2026-09-29

`Aspect`, `Sampler` et `Scheduler` sont des objets de littéraux : `Sampler.Euler` vaut `"euler"`. L'autocomplétion se fait sur le membre, et ComfyUI reçoit la même chaîne qu'avant. Les listes du CLI sont dérivées de ces objets.

## 0.3.0 — 2026-09-29

`generateQwenImage` enchaîne l'envoi, l'attente et le téléchargement à partir d'un `QwenImageOptions`. Le serveur et le dossier de sortie restent hors de cet objet. `src/generate.ts` ne fait plus que lire les arguments, l'environnement et les défauts. `src/example.ts` montre le même appel avec des options écrites dans le programme.

## 0.2.0 — 2026-09-29

`QwenImageOptions` expose le fichier UNET, le ratio d'aspect et les réglages du KSampler (sampler, graine, pas, scheduler). Les défauts restent ceux du workflow simple. Le budget de pixels reste à 1 mégapixel.

## 0.1.0 — 2026-09-29

Client Bun qui envoie le graphe API Qwen Image 2.1 (workflow UI `image_qwen_image_2_1_t2i_001_simple`) à `POST /prompt`. Le prompt et le négatif sont des arguments, posés sur les inputs nommés du nœud `TextEncodeQwenImage21`. Le fichier UI n'est pas modifié : `widgets_values` et `widgets_values_named` ne sont pas le format attendu par l'API.
