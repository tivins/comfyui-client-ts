# Reprise — comfyui-client-ts (2026-11-23)

## Où j'en suis
- 0.26.0 (`MiniMaxH3Options.loras`) pas essayée sur le serveur.
- Publié sur GitHub (`tivins/comfyui-client-ts`, remote `github`) depuis 0.26.1 ; `origin` reste le VPS.
- 0.25.0 (`generateMiniMaxH3Image`, ComfyUI ≥ 0.45) poussée avec les tags `v0.24.0`, `v0.24.1`, `v0.25.0`. Branchée dans llm-multi-ts 0.33.0 (`"model": "minimax-h3-image"`).
- ComfyUI 0.45.3 (2026-11-13) : Krea 2, MiniMax H3 Image, H3 vidéo (481 s, inchangé) et Music 3 (60 s en 138 s) vérifiés ; Qwen, FLUX 3 Klein, SeedVR2 et l'interpolation pas encore. Essais dans `output/comfy-0.45/`.

## En attente de toi
- [ ] Lyrics générées par LLM local : des didascalies `(Guitars chug)` sont chantées. Conseils donnés le 2026-10-18 (règles de lyrics dans le prompt, filtre qui retire `(…)` et les tags hors liste, schéma JSON en sections avec `tag` en enum, ou deux appels lyrics → caption). Rien codé. À décider : quoi faire, et où (projet du prompt LLM, ou un `sanitizeLyrics` ici).
- [ ] Idée « voix » (John, June…) : description en anglais injectée telle quelle par le code dans la ligne `Vocal Gender & Timbre` (Singer A/B), le reste des Vocal Details écrit par le LLM. MiniMax Music 3 n'a pas de voix de référence : la voix variera d'un morceau à l'autre. À tester sur 3–4 morceaux avant de bâtir la bibliothèque.

## Prochaines étapes
- 0.29.0 (int8 par défaut pour MiniMax H3) commitée, pas poussée. À essayer : une LoRA en int8 (casse le mouvement en NVFP4) ; int8 Turbo comme brouillon de l'int8 complet, sur 2–3 autres images.
- `TODO.md` : lire les métadonnées mp4 via le graphe d'API (un vieux mp4 de `ComfyUI/input` les porte dans le tag `comment`, format VideoHelperSuite).
  - Attendu aussi par diffusion_explorer (2026-10-21) : son `bun scan` indexe les vidéos sans provenance tant que ce lecteur manque.
- Peut-être une fonction `generateKrea2Inpaint` si la retouche locale finit par marcher (pour l'instant, non).
- Demandé par flow_editor, et aussi par llm-multi-ts : un `signal` pour vraiment arrêter une génération (`POST /interrupt`).
  - Précisé par llm-multi-ts (2026-10-21) : sa lib `Media` (pour llm-chat-ts, l'utilisateur annule une image) passe déjà un `AbortSignal` et rejette tout de suite, mais le rendu continue sur le serveur. Il faudrait `GenerateSettings.signal` : à l'abort, retirer le prompt de la file (`POST /queue` `delete`) s'il attend, `POST /interrupt` s'il tourne, puis rejeter avec `signal.reason`. llm-multi-ts n'aura qu'à le passer dans `settings` (`src/lib/media.ts`, `generate`).
- Piste de llm-multi-ts (2026-10-18, rien décidé) : le délai de `waitForHistory` est fixe (30 min, `TIMEOUT_MS`, `client.ts:12`) et compte depuis l'envoi, attente dans la file ComfyUI comprise. Interroger `/queue` dirait si le job attend ou s'il tourne, et permettrait de ne compter que le temps d'exécution.

## Rappels
- Les fichiers générés sont dans `output/` (ignoré par git) ; ils s'écoutent avec la page de `/data/media/localGeneration`.
- MiniMax H3 vidéo : la NVFP4 vient d'un dépôt communautaire (`lilcheaty/MiniMax-H3-NVFP4`) ; l'encodeur, les VAE et l'int8 de Comfy-Org (téléchargée sur forge) sont officiels.
- Un graphe identique au précédent est servi par le cache de ComfyUI : avec `deleteFromServer`, son fichier a déjà été effacé, et `runGraph` lève une erreur qui le dit. Changer la graine.
- `KREA2_DEFAULTS` porte `loras` et `batchSize` : flow_editor a 2 tests en échec et une erreur de typage à cause de ça (noté dans son NEXT.md).
- Publier une version : tag annoté `v<version>`, puis `git push --follow-tags origin master` et `git push --follow-tags github master`. Ailleurs : `github:tivins/comfyui-client-ts#v<version>`.
