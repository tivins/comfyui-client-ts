# Changelog

## 0.4.0 — 2026-09-29

`Aspect`, `Sampler` et `Scheduler` sont des objets de littéraux : `Sampler.Euler` vaut `"euler"`. L'autocomplétion se fait sur le membre, et ComfyUI reçoit la même chaîne qu'avant. Les listes du CLI sont dérivées de ces objets.

## 0.3.0 — 2026-09-29

`generateQwenImage` enchaîne l'envoi, l'attente et le téléchargement à partir d'un `QwenImageOptions`. Le serveur et le dossier de sortie restent hors de cet objet. `src/generate.ts` ne fait plus que lire les arguments, l'environnement et les défauts. `src/example.ts` montre le même appel avec des options écrites dans le programme.

## 0.2.0 — 2026-09-29

`QwenImageOptions` expose le fichier UNET, le ratio d'aspect et les réglages du KSampler (sampler, graine, pas, scheduler). Les défauts restent ceux du workflow simple. Le budget de pixels reste à 1 mégapixel.

## 0.1.0 — 2026-09-29

Client Bun qui envoie le graphe API Qwen Image 2.1 (workflow UI `image_qwen_image_2_1_t2i_001_simple`) à `POST /prompt`. Le prompt et le négatif sont des arguments, posés sur les inputs nommés du nœud `TextEncodeQwenImage21`. Le fichier UI n'est pas modifié : `widgets_values` et `widgets_values_named` ne sont pas le format attendu par l'API.
