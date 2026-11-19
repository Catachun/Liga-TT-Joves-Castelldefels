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
from PIL import ImageDraw, ImageFilter
sc = 0.62
esc = frame.crop((100,28,346,270)); lem = frame.crop((1140,0,1520,270))
m = Image.new('L',esc.size,0); ImageDraw.Draw(m).ellipse([3,3,esc.width-3,esc.height-3],fill=255)
m = m.filter(ImageFilter.GaussianBlur(2))
bgc = (0,0,0)
ml = Image.new('L',lem.size,0); ImageDraw.Draw(ml).rectangle([30,10,lem.width-30,lem.height-10],fill=255)
ml = ml.filter(ImageFilter.GaussianBlur(14))
esc = esc.resize((round(esc.width*sc),round(esc.height*sc)), Image.LANCZOS); m = m.resize(esc.size, Image.LANCZOS)
lem = lem.resize((round(lem.width*sc),round(lem.height*sc)), Image.LANCZOS); ml = ml.resize(lem.size, Image.LANCZOS)
hh = max(esc.height,lem.height)+26
head = Image.new('RGB',(W,hh),(0,0,0))
d = ImageDraw.Draw(head)
for y in range(hh):                         # degradat lila suau a dalt
    t = 1-y/hh
    d.line([(0,y),(W,y)], fill=(round(46*t*t),round(14*t*t),round(80*t*t)))
head.paste(esc,(70,(hh-esc.height)//2),m); head.paste(lem,(W-70-lem.width,(hh-lem.height)//2),ml)
def grad(h, c1, c2):                        # barra groc -> lila (i tornada)
    g = Image.new('RGB',(W,h))
    gd = ImageDraw.Draw(g)
    for x in range(W):
        t = abs(2*x/W-1)
        gd.line([(x,0),(x,h)], fill=tuple(round(c1[i]*(1-t)+c2[i]*t) for i in range(3)))
    return g
Y,L = (245,197,24),(123,47,190)
head.paste(grad(6,L,Y),(0,0)); head.paste(grad(4,Y,L),(0,hh-4))
out = Image.new('RGB',(W,hh+photo.height+band.height),(0,0,0))
out.paste(head,(0,0)); out.paste(photo,(0,hh)); out.paste(band,(0,hh+photo.height))
out.save(a[2], quality=92)
print(out.size)
