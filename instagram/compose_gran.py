#!/usr/bin/env python3
"""Foto gran a tota l'amplada + franja de sponsors del marc a sota (jugadors amb més presència).
Ús: compose_gran.py foto.jpg sortida.jpg [--crop-y 0.7] [--ph 1000]"""
import sys
from PIL import Image
frame = Image.open(__file__.replace('compose_gran.py','template/marc-sponsors.png')).convert('RGB')
W,H = frame.size
a = sys.argv
cy = float(a[a.index('--crop-y')+1]) if '--crop-y' in a else 0.7
ph = int(a[a.index('--ph')+1]) if '--ph' in a else 1000
photo = Image.open(a[1]).convert('RGB')
s = W/photo.width
photo = photo.resize((W, round(photo.height*s)), Image.LANCZOS)
y0 = round(max(0,photo.height-ph)*cy)
photo = photo.crop((0,y0,W,y0+min(ph,photo.height)))
band = frame.crop((0,488,W,H))          # "AMB EL SUPORT DE" + logos
out = Image.new('RGB',(W,photo.height+band.height),(0,0,0))
out.paste(photo,(0,0)); out.paste(band,(0,photo.height))
out.save(a[2], quality=92)
print(out.size)
