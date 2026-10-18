# Changelog

## 0.15.0 — 2026-10-18

`readMp3Metadata` lit les tags `prompt` (graphe API) et `workflow` (graphe UI) d'un mp3 ComfyUI : des frames ID3v2 `TXXX`, en ID3v2.3 ou 2.4, encodées en latin-1, UTF-16 ou UTF-8, désynchronisées ou non. Les frames compressées ou chiffrées sont ignorées. Un mp3 sans tag, ou un tag absent, donne `null`. `readMp3MetadataFile` fait la même lecture depuis un chemin, sans lire l'audio. Le `meta` passé à `generateMiniMaxMusic3` se relit ainsi dans le `_meta` de l'UNET (`37:6`).

## 0.14.0 — 2026-10-15

`bun batch-music <playlist.json>` (`src/batch-music.ts`) génère une playlist MiniMax Music 3 et garde autant de morceaux par piste qu'il y a de `seeds`, tour par tour. Les fichiers `<id>_s<graine>.mp3` vont dans `output/music/<nom>/`. Un morceau sous `minDuration` part dans `rejected/` et la graine suivante est essayée (`retries`, 2 par défaut). Un morceau arrêté par `maxDuration` est gardé et signalé. Les morceaux gardés sont égalisés à `loudness` LUFS (−16 par défaut, crête −1,5 dBTP) avec `ffmpeg loudnorm` en deux passages. Les fichiers déjà présents sont sautés ; un échec n'arrête pas la suite ; chaque essai est noté dans `report.tsv`. Options `--out`, `--only`, `--count`, `--server`, `--dry-run`. `runBatch` prend ses dépendances (génération, durée, égalisation) en argument pour les tests.

`playlists/focus.json` : 12 descriptions instrumentales pour travailler, écrites selon le skill `music-caption-rewriter`, 3 morceaux par piste, entre 90 et 240 s, paroles faites de 22 balises (`[Intro]`, `[Instrumental]`, `[Solo]`, `[Bridge]`, `[Outro]`) : le modèle s'arrête plus tard quand il y a plus de balises.

## 0.13.0 — 2026-10-14

`generateMiniMaxMusic3` génère un morceau (mp3) avec MiniMax Music 3. `buildMiniMaxMusic3Prompt` reproduit le graphe exporté de l'interface (`docs/workflow_audio_minimax_music_3.json`). `MiniMaxMusic3Options` porte `caption`, `lyrics`, `seed`, `maxDuration`, `steps`, `cfg`, `cfgScale` et `topK` ; `MINIMAX_MUSIC3_DEFAULTS` donne les valeurs du workflow (60 s, 30 pas, cfg 1.7, top_k 50). `meta` va dans le `_meta` de l'UNET (`37:6`).

`runGraph` télécharge aussi les fichiers rangés sous `audio` dans l'historique, en plus de `images`. Sans fichier, l'erreur devient « Aucun fichier dans l'historique ».

`bun example:music` lance `src/example-music.ts` : un morceau orchestral épique avec chœur, dont la description suit le skill `music-caption-rewriter`.

## 0.12.0 — 2026-10-13

Rangement. Le code commun à tous les modèles passe de `qwen-image.ts` à `client.ts` (`runGraph`, `clearHistory`, `GenerateSettings`). Chaque modèle a son fichier dans `src/models/` : `qwen-image.ts`, `krea2.ts` et `wan22.ts`, chacun avec ses défauts, ses options, son graphe et sa fonction `generate…`. `workflow.ts` ne garde que les types du graphe, `Aspect`, `Sampler`, `Scheduler`, `LoRA`, `chainLoras` et `applyMeta`. Les noms exportés par `"comfyui-client"` ne changent pas, sauf ceux du logger.

Changement de signature : `logger` et `meta` passent dans `GenerateSettings`. `generateQwenImage`, `generateKrea2`, `generateKrea2Edit` et `generateWan22` prennent `(options, settings)`. `LoggerInterface` et `DefaultLogger` sont remplacés par `Logger`, dont les méthodes ont les signatures de `console` (qui peut être passé tel quel), et `silentLogger`, utilisé par défaut. Les messages de progression passent tous par le logger. `generateQwenImage` et `generateKrea2` n'affichent plus leurs options sur la console. La classe `ComfyAPI`, inutilisée, est retirée.

`meta` est ajouté au `_meta` existant au lieu de le remplacer. Il marche pour les quatre graphes : UNET pour Qwen (483) et Krea 2 (1, 55), image d'entrée pour Wan 2.2 (97). `buildQwenImagePrompt` et `buildWan22Prompt` acceptent `meta` comme les builders Krea 2.

`Wan22Options` ne garde que les champs branchés sur le graphe : `inputImage`, `prompt`, `width`, `height`, `seed`, `fps`. Les autres (`negativePrompt`, `unetName`, `samplerName`, `steps`, `cfg`, `scheduler`, `loras`, `batchSize`) n'avaient aucun effet. Le `_meta` de test du nœud 97 est retiré.

Le `.gitignore` racine n'ignore plus que `/models/`, pour que `client-ts/src/models/` soit suivi.

## 0.11.0 — 2026-10-13

`generateKrea2Edit` génère une image Krea 2 à partir d'une image de référence, avec la LoRA Identity Edit et les nœuds `comfyui-krea2edit`. L'image locale est d'abord envoyée par `uploadImage` (`POST /upload/image`). `buildKrea2EditPrompt` reproduit le graphe exporté de l'interface (`docs/workflow_krea2_identity_edit_mei_laughing.json`). La référence passe en latent dans `Krea2EditModelPatch` et dans Qwen3-VL par `Krea2EditGroundedEncode`. Réglages : `refBoost` (4), `groundingPx` (768), `fitMode`, `editLora`. Les autres LoRA de `loras` s'appliquent après la LoRA d'édition. `KREA2_EDIT_DEFAULTS`, `FitMode` et le type `LoRA` sont exportés.

`buildKrea2Prompt` produit le même graphe qu'avant. Les options des tests Krea 2 reçoivent `loras` et `batchSize`, qui manquaient depuis l'ajout des LoRA.

## 0.10.0 — 2026-10-03

`readPngMetadata` lit les chunks PNG `prompt` (graphe API) et `workflow` (graphe UI). `tEXt`, `zTXt`, `iTXt` et le chunk `comf` des PNG animés sont acceptés. `readPngMetadataFile` fait la même lecture depuis un chemin. Un chunk absent vaut `null`.

## 0.9.0 — 2026-10-02

`buildKrea2Prompt` reprend le graphe UI `krea2_safetensor` : UNET Muse int8, CLIP `qwen3vl_4b` en type `krea2`, VAE `qwen_image_vae`, deux `CLIPTextEncode`, latent 960×1472, `KSampler` euler / simple / 16 pas / cfg 1.5. `generateKrea2` envoie ce graphe avec les mêmes réglages de serveur que `generateQwenImage`.

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
