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
# capçalera fina amb escut (esq.) i lema (dta.) retallats del marc
sc = 0.62
esc = frame.crop((95,50,375,310)); lem = frame.crop((1140,0,1520,270))
esc = esc.resize((round(esc.width*sc),round(esc.height*sc)), Image.LANCZOS)
lem = lem.resize((round(lem.width*sc),round(lem.height*sc)), Image.LANCZOS)
hh = max(esc.height,lem.height)+10
head = Image.new('RGB',(W,hh),(0,0,0))
head.paste(esc,(70,(hh-esc.height)//2)); head.paste(lem,(W-70-lem.width,(hh-lem.height)//2))
out = Image.new('RGB',(W,hh+photo.height+band.height),(0,0,0))
out.paste(head,(0,0)); out.paste(photo,(0,hh)); out.paste(band,(0,hh+photo.height))
out.save(a[2], quality=92)
print(out.size)
