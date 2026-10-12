#!/usr/bin/env python3
"""Compon una foto dins del marc de sponsors, amb vores difuminades.
Ús: compose.py foto.jpg sortida.jpg [--crop-y 1.0]"""
import sys
from PIL import Image, ImageFilter, ImageDraw
frame = Image.open(__file__.replace('compose.py','template/marc-sponsors.png')).convert('RGB')
W,H = frame.size
photo = Image.open(sys.argv[1]).convert('RGB')
cy = float(sys.argv[sys.argv.index('--crop-y')+1]) if '--crop-y' in sys.argv else 1.0
# zona central: y 25..505, x 330..1270 (entre logo i lema, per sobre de "AMB EL SUPORT")
bw, bh, bx, by = 820, 480, (W-820)//2, 25
# retall apaïsat de la foto (tota l'amplada)
ch = round(photo.width*bh/bw)
y0 = round((photo.height-ch)*cy)
photo = photo.crop((0,y0,photo.width,y0+ch)).resize((bw,bh), Image.LANCZOS)
# màscara amb vores difuminades
m = Image.new('L',(bw,bh),0)
ImageDraw.Draw(m).rectangle([40,30,bw-40,bh-8], fill=255)
m = m.filter(ImageFilter.GaussianBlur(24))
frame.paste(photo,(bx,by),m)
frame.save(sys.argv[2], quality=92)
