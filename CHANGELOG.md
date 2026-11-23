# Changelog

## 0.29.0 — 2026-11-23

`MINIMAX_H3_DEFAULTS.unetName` passe à la diffusion int8 de Comfy-Org (`MiniMaxH3Model.Int8`, 21 Go, `download_minimax_h3.sh int8`), celle du modèle de workflow, au lieu de la NVFP4 communautaire de lilcheaty. Comparées sur la même image et la même graine en 512 × 768, 5 s, sur une RTX 5060 Ti : l'int8 ne prend que 4 à 10 % de temps en plus (284 s contre 273 s, 128 s contre 116 s avec `turbo`) malgré le débordement en RAM, et garde le pelage et les moustaches avec `turbo`, que la NVFP4 lisse. Le mouvement diverge entre les deux après ~2 s : une vidéo NVFP4 ne sert pas de brouillon à l'int8. Le serveur doit avoir la diffusion int8 ; `unetName: MiniMaxH3Model.Nvfp4` redonne l'ancien comportement.

## 0.28.0 — 2026-11-23

`generateMossImage` génère une image avec MOSS-Image (OpenMOSS, 5B, Apache-2.0), avec ou sans mise en page par boîtes (`boxes`). `buildMossImagePrompt` reprend les modèles de workflow `image_moss_image_t2i` et `image_moss_image_t2i_bboxes` de ComfyUI, sans prompt upsampler. Chaque `MossBox` porte sa position en pixels, son `kind` (`MossBoxKind` : `object`, `character`, `text`), sa `description` et, pour un texte, le `text` à écrire ; les boîtes passent par `CreateBoundingBoxes` et `MOSSImageLayoutPrompt`, dont le prompt JSON remplace le texte de l'encodeur, et les boîtes `character` vont à `character_boxes` par leur numéro. `MOSS_IMAGE_DEFAULTS` : 1024², 25 pas, cfg 2.5, er_sde / simple, Skip Layer Guidance sur la couche 22 de 0 à 0,5 (`skipLayerGuidance`, `null` pour le retirer), diffusion SFT bf16, encodeur Qwen3.5-9B int8, VAE FLUX.2. Largeur et hauteur doivent être des multiples de 16, et une boîte de texte a un `text`, sinon une erreur. `ApiInput` accepte `ApiListValue` (`{ __value__: [...] }`, exporté) : une liste nue serait prise pour un lien par ComfyUI. Exemple : `src/example-moss.ts` (`bun run example:moss`). Demande ComfyUI ≥ 0.46.0. Comparé à Krea 2 sur 4 prompts : textes exacts des deux côtés, meilleure mise en page d'affiche et peau plus naturelle, 62 à 76 s par image contre ~50 s ; avec boîtes, positions et nombre d'objets respectés.

## 0.27.0 — 2026-11-21

`MiniMaxH3Options.saveLastFrame` enregistre aussi la dernière image de la vidéo MiniMax H3 en PNG : `ImageFromBatch` (nœud 93, `batch_index: -1`) la prend à la sortie du VAE vidéo, avant `CreateVideo`, et `SaveImage` (94) l'écrit avec le préfixe `video/MiniMax_H3_last` (`MINIMAX_H3_LAST_FRAME_PREFIX`). Elle échappe à la compression H.264 du mp4, qui s'ajoutait à chaque vidéo enchaînée sur la fin de la précédente. Actif par défaut (`MINIMAX_H3_DEFAULTS.saveLastFrame`). `generateMiniMaxH3` renvoie toujours la vidéo d'abord, puis le PNG (`videoFirst`, exporté) : un appelant qui prend le premier fichier reçoit la vidéo comme avant. `false` redonne le graphe du modèle de workflow. Demandé par llm-multi-ts-ui (suites de vidéos qui se dégradent).

## 0.26.1 — 2026-11-18

Publication sur GitHub (`github:tivins/comfyui-client-ts`) sous licence MIT (`LICENSE`, champ `license` du `package.json`). Le README s'installe par `github:tivins/comfyui-client-ts#v<version>` et ne renvoie plus aux chemins et au serveur de la machine de travail. Code inchangé.

## 0.26.0 — 2026-11-14

`MiniMaxH3Options.loras` applique des LoRA à la vidéo MiniMax H3, comme `Krea2Options.loras` : une liste `{ model, weight }` de `LoraLoaderModelOnly` enchaînés après la diffusion, et après la LoRA Turbo quand `turbo` est actif, qui alimentent le scheduler et le guider. Les LoRA doivent être entraînées pour MiniMax H3. `MINIMAX_H3_DEFAULTS.loras` vaut `[]` : sans LoRA, le graphe ne change pas. Demandé par llm-multi-ts.

## 0.25.0 — 2026-11-13

`generateMiniMaxH3Image` génère une image avec MiniMax H3 Image, sans image ou avec 1 à 100 images (`referenceImages`, chemins locaux envoyés avec `uploadImage`) que le prompt nomme `<Picture 1>`, `<Picture 2>`… ; la première est l'image à éditer. `buildMiniMaxH3ImagePrompt` reprend les modèles de workflow `image_minimax_h3_image_t2i` et `image_minimax_h3_image_edit` de ComfyUI, sans prompt enhancer ni redimensionnement en amont : `MiniMaxH3ImageConditioning` met lui-même les images à l'échelle. `MiniMaxH3ImageOptions` porte `prompt`, `referenceImages`, `width`, `height` (0 : 2048² sans image, la taille de la première image sinon), `seed`, `steps`, le sampler et les fichiers. `MINIMAX_H3_IMAGE_DEFAULTS` : 6 pas, cfg 1, euler / simple, diffusion w4a8 (`MiniMaxH3ImageModel.W4a8`, 12,5 Go) et l'encodeur Qwen3-VL NVFP4 de MiniMax H3 vidéo. `MINIMAX_H3_IMAGE_MAX_REFERENCES` vaut 100 ; au-delà, une erreur. Demande ComfyUI ≥ 0.45.0. Sur une RTX 5060 Ti : 27 s pour 2048² sans image, 34 s pour une édition en 1024 × 1568, modèles froids.

## 0.24.1 — 2026-11-09

`runGraph` échoue tout de suite quand ComfyUI met le prompt en erreur. ComfyUI 0.41 l'inscrit dans l'historique avec `status_str: "error"` mais `completed: false` : `waitForHistory` attendait jusqu'au délai de 30 min, GPU tenu. Le message d'erreur donne maintenant le type et l'id du nœud fautif, et la première ligne de son exception (`Génération en échec : KSampler (nœud 2) : …`), au lieu du statut entier en JSON.

## 0.24.0 — 2026-11-09

`generateFlux3Klein` génère une image avec FLUX 3 Image Klein (BFL, 5,6B, distillé int8), sans référence ou avec 1 à 10 images de référence (`referenceImages`, chemins locaux envoyés avec `uploadImage`), que le prompt nomme dans l'ordre (« the first image »…). `buildFlux3KleinPrompt` reprend le sous-graphe des workflows `flux3_klein_int8_mi2i` / `t2i` du dépôt Comfy de BFL, sans prompt upsampler ni boîtes ; sans référence, `ReferenceMultiLatent` est retiré. `Flux3KleinOptions` porte `prompt`, `referenceImages`, `width`, `height`, `seed`, `steps`, `alpha` (shift ln(alpha)), `referenceMegapixels`, `batchSize`, le sampler et les fichiers. `FLUX3_KLEIN_DEFAULTS` : 1024², 16 pas, alpha 16, références à 1 Mpx. `FLUX3_KLEIN_MAX_REFERENCES` vaut 10 ; au-delà, une erreur. Demande ComfyUI ≥ 0.41.0. Sur une RTX 5060 Ti : 12 s à 1 Mpx sans référence, 24 s en 1280 × 720 avec deux.

## 0.23.1 — 2026-10-26

`GenerationProgress.nodesTotal` est documenté comme un maximum : la branche non prise d'un `ComfySwitchNode` ne s'exécute pas, et `nodesDone` n'atteint alors pas le total (Wan 2.2 : 26 nœuds sur 32). Le README le dit, avec ce qu'ont montré les essais sur le serveur : les pas des samplers mesurent mieux l'avancement, et le chargement d'un modèle se fait souvent au début du sampler, avant son premier pas. Essais avec `onProgress` sur une RTX 5060 Ti : Qwen 8 pas (16 s), Wan 2.2 par défaut (1323 s, deux séries de 10 pas, environ 64 s par pas), MiniMax H3 par défaut (477 s, 20 pas d'environ 22 s, 14 nœuds sur 14). Aucun changement de code.

## 0.23.0 — 2026-10-26

`GenerateSettings.onProgress` reçoit l'avancement d'une génération : `runGraph` ouvre le WebSocket `/ws?clientId=…` de ComfyUI avant `POST /prompt`, qui reçoit maintenant `client_id`, et appelle le callback au début de chaque nœud et à chaque pas. `GenerationProgress` (`src/progress.ts`, exporté) porte `promptId`, `node`, `classType`, `nodesDone`, `nodesTotal` (hors nœuds repris du cache) et `step` (`{ value, max }` ou `null`). Seuls les messages du prompt lancé sont pris, y compris ceux reçus avant la réponse de `POST /prompt`. Les aperçus binaires sont ignorés. La fin annoncée par le WebSocket réveille tout de suite l'attente sur `/history`, qui reste la source du résultat. Un WebSocket injoignable, ou un callback qui lève une erreur, donne un `logger.warn` sans arrêter la génération. Le message « en cours » du logger ajoute le dernier avancement. Sans `onProgress`, rien ne change.

## 0.22.0 — 2026-10-23

`generateMiniMaxH3` anime une image avec MiniMax H3, son compris : l'image de départ locale (et une dernière image facultative, `lastImage`) est envoyée avec `uploadImage`, puis la vidéo est générée à 24 images/s avec une piste stéréo 32 kHz. `buildMiniMaxH3Prompt` reprend le modèle de workflow « MiniMax H3 Image to Video » (`video_minimax_h3_i2v`), sous-graphe déplié et interrupteurs Turbo résolus. `MiniMaxH3Options` porte `inputImage`, `lastImage`, `prompt`, `width`, `height`, `seed`, `duration`, `steps`, `turbo` et `unetName`. `MINIMAX_H3_DEFAULTS` donne 768 × 768, 5 s, 20 pas sans Turbo et la diffusion NVFP4 (`MiniMaxH3Model.Nvfp4`, 12,5 Go, qui tient dans 16 Go) ; le modèle de workflow prend l'int8 (`MiniMaxH3Model.Int8`). `turbo` ajoute la LoRA Turbo 8 pas v1.1 768p : plus de deux fois plus rapide, mais les détails fins se brouillent au fil de la vidéo. `minimaxH3FrameCount` donne le nombre d'images d'une durée (grille 17k + 5 du modèle : 5 s → 124). Sur une RTX 5060 Ti, 5 s en 768 × 768 : 478 s, 15,8 Go de VRAM au plus.

## 0.21.0 — 2026-10-22

`generateSeedVR2VideoUpscale` agrandit une vidéo avec SeedVR2 7B int8 : la vidéo locale est envoyée avec `uploadImage`, ses images sont agrandies en lanczos puis restaurées ensemble en un pas, et `CreateVideo` la remonte avec les images/s, la profondeur et l'audio d'origine. `buildSeedVR2VideoPrompt` reprend le modèle de workflow « Upscale Video (SeedVR2 3B Int8) » (`workflows/workflow_utility_seedvr2_3b_int8_upscale_video.json`), sans le `Video Slice` ni les interrupteurs. `SeedVR2VideoOptions` porte `video`, `resize`, `framesPerChunk`, `colorCorrection`, `seed`, `tileSize`, `tileOverlap`, `unetName` et `vaeName`. `SEEDVR2_VIDEO_DEFAULTS` donne ×2, correction `lab`, le modèle 7B (déjà téléchargé ; le modèle de workflow prend le 3B) et des morceaux de 33 images. `framesPerChunk` règle `SeedVR2TemporalChunk` en mode manuel, avec 2 latents fondus au recollage ; `null` échantillonne d'un bloc. Le mode auto du modèle de workflow, sur 16 Go, découpe image par image une fois le 7B chargé. Sur une RTX 5060 Ti, 81 images de 640 × 640 en ×2 : 373 s, 13,9 Go de VRAM au plus. `resizeInputs` est maintenant exporté par `seedvr2.ts` pour servir aux deux graphes. Demandé par llm-multi-ts.

## 0.20.0 — 2026-10-22

`generateFrameInterpolation` augmente les images/s d'une vidéo avec RIFE ou FILM : la vidéo locale est envoyée avec `uploadImage`, `FrameInterpolate` ajoute `multiplier - 1` images entre chaque paire, et la vidéo est remontée à `fps × multiplier` avec son audio. Une vidéo Wan 2.2 de 81 images à 16 images/s devient, en ×2, 161 images à 32 images/s, même durée. `buildFrameInterpolationPrompt` reprend le modèle de workflow « Frame Interpolation: FILM or RIFE » de ComfyUI, sans l'interrupteur de ralenti. `FrameInterpolationOptions` porte `video`, `modelName` et `multiplier` ; `FRAME_INTERPOLATION_DEFAULTS` donne RIFE 4.26 en ×2 ; `FrameInterpolationModel` liste les fichiers du dépôt Comfy-Org. Demandé par llm-multi-ts.

`runGraph` ne rapatrie plus les fichiers `type: "input"` de l'historique : `LoadVideo` y renvoie la vidéo chargée en aperçu, qui se retrouvait dans `outputDir` et dans les chemins renvoyés.

## 0.19.0 — 2026-10-22

`generateWan22` prend un chemin local dans `inputImage` et l'envoie avec `uploadImage` avant le graphe, comme `generateKrea2Edit` ; `buildWan22Prompt` prend toujours le nom côté serveur. Les réglages jusqu'ici fixes deviennent des champs de `Wan22Options` : `negativePrompt`, `duration`, `steps`, `splitStep`, `cfg` et `lightning`, qui allume la LoRA lightx2v 4 pas déjà présente dans le graphe (4 pas coupés au pas 2, cfg 1). `WAN22_DEFAULTS` garde les valeurs du workflow d'origine (20 pas coupés au pas 10, cfg 3.5, 5 s à 16 images/s, 640 × 640). Demandé par llm-multi-ts (`videos.ts`). Changement cassant pour `generateWan22`, qui n'avait pas d'autre utilisateur.

## 0.18.2 — 2026-10-20

Le paquet sort du dépôt comfyui et a son propre dépôt git (`vps:/data/git/comfyui-client-ts`), cloné dans `/data/projects/comfyui-client-ts` : les projets qui le prennent par chemin passent à `file:/data/projects/comfyui-client-ts`. Un autre projet peut aussi le prendre par git, figé sur un tag `v<version>`. Les graphes exportés que lisent les tests passent de `../docs/` à `workflows/` (Krea 2 Identity Edit, MiniMax Music 3, SeedVR2). Le README dit ce qui reste dans le dépôt comfyui : scripts de téléchargement des modèles, custom node `comfyui-delete-output`, skill MiniMax. Aucun changement de code.

## 0.18.1 — 2026-10-20

`@types/bun` et `typescript` passent en devDependencies (`bun.lock` ajouté) : `tsconfig.json` demandait les types de Bun sans les installer, et `tsc` ne tournait pas. `bun run typecheck` lance `tsc --noEmit`. Les erreurs qu'il trouvait sont corrigées : `allowImportingTsExtensions` pour les imports en `.ts` des tests, mocks de `fetch` castés en `typeof fetch` comme `fakeServer`, et `env` de `parseBatchArgs` et `parseGenerateArgs` typé `Readonly<Record<string, string | undefined>>`, ce qui accepte `process.env`. Aucun changement de comportement.

## 0.18.0 — 2026-10-20

`generateSeedVR2Upscale` agrandit une image avec SeedVR2 7B int8 : l'image locale est envoyée avec `uploadImage`, agrandie en lanczos, puis restaurée en un pas. `buildSeedVR2Prompt` reproduit le modèle de workflow de ComfyUI (`docs/workflow_utility_seedvr2_7b_int8_upscale_image.json`), sans le nœud `ImageCompare`. `SeedVR2Options` porte `image`, `resize` (`{ multiplier }` ou `{ longerSide }`), `colorCorrection`, `seed`, `tileSize`, `tileOverlap`, `unetName` et `vaeName`. `SEEDVR2_DEFAULTS` donne ×4, correction `lab` (le workflow d'exemple utilise `none`, aux couleurs un peu plus chaudes) et le modèle 7B. `ColorCorrection` liste les valeurs de `SeedVR2PostProcessing`.

## 0.17.0 — 2026-10-20

`runGraph` est exporté par l'entrée du paquet : il envoie un graphe API tel quel (par exemple relu dans un png ou un mp3, puis modifié), attend la fin et enregistre les fichiers produits. Demandé par llm-multi-ts (`remix`) et persona_helper.

## 0.16.0 — 2026-10-19

`deleteFromServer` efface enfin les fichiers produits du dossier `output` du serveur. Jusqu'ici, il ne retirait que le prompt de l'historique et de la file. ComfyUI n'ayant pas de route pour ça, le dépôt ajoute le custom node `custom_nodes/comfyui-delete-output`, qui ajoute `POST /output/delete` (et `/api/output/delete`). La route reçoit `{ files: [{ filename, subfolder, type }] }`, n'accepte que `type: "output"`, vérifie tous les chemins avant d'effacer quoi que ce soit (mêmes garde-fous que `GET /view`), et renvoie `{ deleted, missing }`. Un fichier déjà absent n'est pas une erreur.

`runGraph` appelle cette route avant `POST /history` et `POST /queue`, avec les seuls fichiers `type: "output"`. Si ComfyUI répond 404 ou 405 (custom node absent ou ComfyUI pas redémarré), les fichiers restent, `logger.warn` le signale et l'historique est retiré comme avant. Une autre erreur lève une exception, et l'historique reste.

Un graphe identique au précédent est servi par le cache de ComfyUI, qui renvoie le fichier déjà produit. Si ce fichier a été effacé, `runGraph` le dit dans l'erreur du `GET /view` (404), en s'appuyant sur le message `execution_cached` de l'historique.

`install_comfyui.sh` lie le custom node dans `ComfyUI/custom_nodes/`. Le README décrit l'installation à la main. Le custom node a ses tests Python (`test_output_files.py`).

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
