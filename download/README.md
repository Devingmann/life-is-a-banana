# Life is a Banana: The Cosmic Slip

Jeu de runner physique en Three.js + cannon-es (100% hors-ligne, sans build).

## Fichiers

- `LifeIsABanana_standalone.zip` — le jeu complet, prêt à jouer :
  dézippez puis ouvrez `game/index.html` dans un navigateur (Chrome / Edge / Firefox).
  (Version corrigée du 2026-11-07 — glow adouci, direction réparée, commandes AZERTY.)

## Commandes

| Action | Touches |
| --- | --- |
| Diriger | **ZQSD** (AZERTY) · **WASD** (QWERTY) · **Flèches ← →** |
| Sauter | **Espace** · **↑** · **Z/W** |
| Plongeon (retomber vite) | **↓** · **S** |
| Turbo Banana Split | **Shift** |
| Pause / Muet | **P** / **M** |
| Rejouer (après game over) | **Espace** · **Entrée** · **R** |

## Correctifs de cette version

1. **Glow adouci** : bloom divisé par ~2 (force 0,42, seuil 0,85), exposition 1,0,
   émissifs néon réduits, halos CSS atténués.
2. **La banane avançait à l'envers** : la direction gauche/droite était inversée
   par rapport à la caméra — réparée (gauche = gauche à l'écran).
3. **Plus de blocage après plusieurs chocs** : le rebond comique est désormais
   bloqué pendant l'invulnérabilité (1,5 s) + anti-rebond par obstacle (0,8 s),
   knockback et étourdissement réduits, récupération de vitesse accélérée.
4. **Performance** : pixel ratio plafonné à 1,5, ombres 1024², MSAA ×2, et
   qualité adaptative qui baisse automatiquement la résolution puis les ombres
   si le FPS moyen passe sous 42.
5. **Touches directionnelles + AZERTY** : mappings physiques (insensible à la
   disposition clavier) + repli sur la touche imprimée ; les touches restées
   « coincées » après une perte de focus sont relâchées automatiquement.
