#!/usr/bin/env python3
"""Analyse les captures du jeu : luminosité moyenne + ratio de pixels quasi-blancs.
Un écran blanc saturé aurait meanBrightness > ~200 et whiteRatio élevé."""
import sys
from PIL import Image

def analyze(path):
    img = Image.open(path).convert('RGB')
    img.thumbnail((320, 180))
    px = list(img.getdata())
    n = len(px)
    mean = sum(sum(p) for p in px) / (n * 3)
    white = sum(1 for p in px if p[0] > 235 and p[1] > 235 and p[2] > 235) / n
    return mean, white

for path in sys.argv[1:]:
    mean, white = analyze(path)
    print(f"{path}: mean={mean:.1f}/255, white_ratio={white*100:.2f}%")
