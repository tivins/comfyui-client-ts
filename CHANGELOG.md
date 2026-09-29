# Changelog

## 0.1.0 — 2026-09-29

Client Bun qui envoie le graphe API Qwen Image 2.1 (workflow UI `image_qwen_image_2_1_t2i_001_simple`) à `POST /prompt`. Le prompt et le négatif sont des arguments, posés sur les inputs nommés du nœud `TextEncodeQwenImage21`. Le fichier UI n'est pas modifié : `widgets_values` et `widgets_values_named` ne sont pas le format attendu par l'API.
