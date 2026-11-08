# Life is a Banana: The Cosmic Slip

Jeu de runner physique en Three.js + cannon-es (100% hors-ligne, sans build).

## Fichiers

- `LifeIsABanana_standalone.zip` — le jeu complet, prêt à jouer :
  dézippez puis ouvrez `game/index.html` dans un navigateur (Chrome / Edge / Firefox).
  (**v3 BANANA BALLISTICS du 2026-11-09** — missiles banane, glow maîtrisé,
  clavier infaillible.)

## Commandes

| Action | Touches |
| --- | --- |
| Diriger | **ZQSD** (AZERTY) · **WASD** (QWERTY) · **Flèches ← →** |
| Sauter | **Espace** · **↑** · **Z/W** (maintenu = rebond à chaque atterrissage) |
| **Double saut Heli-Peel** | **Espace ×2** (en l'air) |
| Plongeon-stomp (boost de vitesse) | **↓** · **S** |
| Turbo Banana Split | **Shift** |
| **Missile banane** | **F** · **E** · **Clic** (8 étoiles = +1 munition, dorée = +2) |
| Pause / Muet | **P** / **M** (n'importe quelle touche de jeu reprend la pause) |
| Rejouer (après game over) | **Espace** · **Entrée** · **R** |

## v3 BANANA BALLISTICS — correctifs & nouveautés

### 1. « Ça devient tout blanc quand je prends trop d'étoiles » — RÉSOLU
La formule du bloom pouvait empiler turbo + Super Yellow + flash de zone
jusqu'à ~1,8 de puissance : saturation blanche garantie. Triple correctif :
- bloom de base réduit (strength 0,32, seuil 0,92) et **plafonné
  irrémédiablement à 0,62** — même dans le pire cas empilé ;
- émissifs de la banane (Super Mode), étoiles, bananes dorées, arches,
  grille-pain et soleil tous réduits ; particules additives (sparkles,
  traînée dorée, explosions) plus petites et plus courtes ;
- vérifié au pixel près : le pire cas affiche 107/255 de luminosité moyenne
  (contre un écran uniformément blanc avant).

### 2. « Espace ne marche plus / les touches s'arrêtent » — RÉSOLU
- **Espace maintenu = intention de saut permanente** : la banane rebondit à
  chaque atterrissage et enchaîne le double saut Heli-Peel après 0,3 s de
  maintien. Un appui bref reste un simple saut.
- La pause auto (perte de focus de l'iframe) se **reprend avec n'importe
  quelle touche de jeu ou un clic n'importe où sur l'écran** — plus jamais
  de « touches mortes ».
- Les boutons (pause / muet / start) **rendent le focus après clic** : ils ne
  « volent » plus la barre d'espace.
- Direction plus réactive : convergence latérale 9→14/s au sol, 4,5→7/s en
  l'air ; reset défensif des touches à chaque regain de focus.

### 3. MISSILES DE BANANE (nouveau)
- **F, E ou clic** lance une banane fusée qui file devant (46 + vitesse), avec
  auto-visée douce sur l'obstacle le plus menaçant, traînée d'étincelles et
  rotation propre.
- À l'impact : **KABOOM** — l'obstacle explose (singes, gorilles,
  grille-pain, mixeurs, centrifugeuses), +80 pts et plus avec le combo, shake,
  micro-ralenti et son de détonation procédural.
- **Munitions** : 3 au départ, +1 toutes les 8 étoiles, +2 par banane dorée,
  6 max — HUD dédié dans le panneau droit. Bouton FEU tactile sur mobile.
- Bonus caché : le 2ᵉ bras de la centrifugeuse (corps « fantôme » invisible
  après destruction) est désormais retiré proprement aussi bien en Super
  Mode qu'au missile.

## v2 COSMIC+ — correctifs & nouveautés

### Correctifs
1. **« La banane reste bloquée après 5 s » — RÉSOLU** : le premier champ
   d'obstacles tombe pile vers 5 s de course ; l'ancien rebond faisait atterrir
   la banane *devant* la boîte de l'obstacle et l'accélération la plaquait
   contre sa face verticale (blocage physique). Triple correctif :
   - rebond en arc haut (v.y 7,4) + poussée latérale forte (×7,5) → la banane
     franchit l'obstacle au lieu de s'y coller ;
   - **watchdog anti-blocage** : si la vitesse reste quasi nulle ~0,85 s, la
     banane « glisse à travers le cosmos » (téléport de 3,4 m, invulnérabilité
     1,1 s, warp sonore) — un run ne peut JAMAIS geler ;
   - récupération de vitesse accélérée (13 au lieu de 11).
2. **Erreur console Next.js (hydration)** : causée par une extension navigateur
   (attributs `bis_*` / `__processed_*` injectés dans le DOM avant React) — pas
   par le jeu. Mitigée via `suppressHydrationWarning` sur l'iframe et le body.

### Difficulté & renouvellement
3. **Courbe de difficulté accélérée** : pression maximale vers 1 200 m (au lieu
   de 3 000), vitesse de base 18→62 (au lieu de 17→48), jusqu'à 6 obstacles par
   chunk, espacement réduit, trous plus larges (jusqu'à 12,5 m, parfois doubles).
4. **ZONES tous les 400 m** : JUNGLE NÉON → OURAGAN VIOLET → INFERNO SOLAIRE →
   VIDE FANTÔME → SINGULARITÉ BANANE (puis II, III…) — palette complète
   (bordures néon, palmiers, soleil, grille, brouillard) + jingle + flash +
   bonus de vitesse +5 % par zone (cumul. max +30 %).
5. **Nouveaux obstacles** : singes **patrouilleurs** qui traversent la route,
   **Grande Centrifugeuse** (bras néon rotatifs à sauter, timing pur) et
   **barrage de toasts** — les grille-pain tirent des toasts brûlants en cloche
   vers votre voie à haute difficulté (esquive ou glissade).

### Fun & juice
6. **Double saut Heli-Peel** (vrille + son), **plongeon-stomp** (onde de choc +
   pop de vitesse), **speed pads** chevrons turquoise (« ZOOM ! », +22 % pendant
   1,15 s), **FRÔLÉ !** — bonus de score + potassium pour les passages au ras
   des obstacles (risk/reward), **Bananes Dorées** rares (+500, turbo plein,
   +0,3 potassium, fanfare).
7. **Écran de game over arcade** : rang **D/C/B/A/S/S+** animé + stats
   (vitesse max, frôlés, obstacles smashés).
8. **Billboards néon à blagues** le long de la route (« LA VIE EST UNE BANANE »,
   « OBEY THE MOON », « SPEED LIMIT OUI OUI »…), nouveaux patterns d'étoiles
   (zigzag, double arche), roulis de caméra dans les virages, flash rouge
   dégâts / flash zone, badge de zone dans le HUD, 8 nouveaux SFX procéduraux.

## Performance

Pixel ratio plafonné à 1,5, ombres 1024², MSAA ×2, qualité adaptative qui
baisse automatiquement la résolution puis les ombres si le FPS moyen passe
sous 42. Le watchdog anti-blocage garantit aussi qu'aucun incident physique
ne fige le run.
