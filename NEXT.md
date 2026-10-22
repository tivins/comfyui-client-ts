# Reprise — comfyui-client-ts (2026-10-22)

## Où j'en suis
- 0.19.0 codée, **pas commitée** (demandée par llm-multi-ts, `videos.ts`) : `generateWan22` envoie l'image locale, `WAN22_DEFAULTS`, `steps`/`splitStep`/`cfg`/`duration`/`negativePrompt`/`lightning` (LoRA lightx2v 4 pas). 97 tests OK, `tsc` propre. Pas encore essayée sur le serveur.
- 0.18.2 : la lib a son dépôt (`vps:/data/git/comfyui-client-ts`, tags `v0.11.0` … `v0.18.2`), clonée ici. Venait de `/data/softwares/comfyui/client-ts`. llm-multi-ts, persona_helper, flow_editor et `client-ts-example` pointent maintenant vers `file:/data/projects/comfyui-client-ts`.
- 0.18.0 : `generateSeedVR2Upscale` (SeedVR2 7B int8 ; modèles via `download_seedvr2.sh` du dépôt comfyui). 0.18.1 : `bun run typecheck`.
- Les morceaux et images générés sont dans `output/` (ignoré par git, déplacé ici avec la lib). Ils s'écoutent avec la page de `/data/media/localGeneration`.

## En attente de toi
- [ ] Lyrics générées par LLM local : des didascalies `(Guitars chug)` sont chantées. Conseils donnés le 2026-10-18 (règles de lyrics dans le prompt, filtre qui retire `(…)` et les tags hors liste, schéma JSON en sections avec `tag` en enum, ou deux appels lyrics → caption). Rien codé. À décider : quoi faire, et où (projet du prompt LLM, ou un `sanitizeLyrics` ici).
- [ ] Idée « voix » (John, June…) : description en anglais injectée telle quelle par le code dans la ligne `Vocal Gender & Timbre` (Singer A/B), le reste des Vocal Details écrit par le LLM. MiniMax Music 3 n'a pas de voix de référence : la voix variera d'un morceau à l'autre. À tester sur 3–4 morceaux avant de bâtir la bibliothèque.

## Prochaines étapes
- `TODO.md` : lire les métadonnées mp4 via le graphe d'API (un vieux mp4 de `ComfyUI/input` les porte dans le tag `comment`, format VideoHelperSuite).
  - Attendu aussi par diffusion_explorer (2026-10-21) : son `bun scan` indexe les vidéos sans provenance tant que ce lecteur manque.
- Peut-être une fonction `generateKrea2Inpaint` si la retouche locale finit par marcher (pour l'instant, non).
- Demandé par flow_editor, et aussi par llm-multi-ts : un `signal` pour vraiment arrêter une génération (`POST /interrupt`).
  - Précisé par llm-multi-ts (2026-10-21) : sa lib `Media` (pour llm-chat-ts, l'utilisateur annule une image) passe déjà un `AbortSignal` et rejette tout de suite, mais le rendu continue sur le serveur. Il faudrait `GenerateSettings.signal` : à l'abort, retirer le prompt de la file (`POST /queue` `delete`) s'il attend, `POST /interrupt` s'il tourne, puis rejeter avec `signal.reason`. llm-multi-ts n'aura qu'à le passer dans `settings` (`src/lib/media.ts`, `generate`).
- Piste de llm-multi-ts (2026-10-18, rien décidé) : le délai de `waitForHistory` est fixe (30 min, `TIMEOUT_MS`, `client.ts:12`) et compte depuis l'envoi, attente dans la file ComfyUI comprise. Interroger `/queue` dirait si le job attend ou s'il tourne, et permettrait de ne compter que le temps d'exécution.

## Rappels
- Un graphe identique au précédent est servi par le cache de ComfyUI : avec `deleteFromServer`, son fichier a déjà été effacé, et `runGraph` lève une erreur qui le dit. Changer la graine.
- `KREA2_DEFAULTS` porte `loras` et `batchSize` : flow_editor a 2 tests en échec et une erreur de typage à cause de ça (noté dans son NEXT.md).
- Publier une version : tag `v<version>` puis `git push --follow-tags`. Les projets d'autres machines la prennent par `git+ssh://vps:/data/git/comfyui-client-ts#v<version>`.
