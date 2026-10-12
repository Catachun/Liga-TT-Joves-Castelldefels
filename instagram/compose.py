#!/usr/bin/env python3
"""Compon una foto dins del marc de sponsors. Ús: compose.py foto.jpg sortida.jpg"""
import sys
from PIL import Image, ImageDraw
frame = Image.open(__file__.replace('compose.py','template/marc-sponsors.png')).convert('RGB')
W,H = frame.size
photo = Image.open(sys.argv[1]).convert('RGB')
# zona lliure central: y 40..500, entre logo (x<350) i lema (x>1180)
box_h = 425; box_y = 45
box_w = round(box_h*photo.width/photo.height)
box_w = min(box_w, 1380)
photo = photo.resize((box_w, box_h), Image.LANCZOS)
x = (W-box_w)//2
d = ImageDraw.Draw(frame)
d.rectangle([x-5,box_y-5,x+box_w+4,box_y+box_h+4], fill=(255,200,0))
frame.paste(photo,(x,box_y))
frame.save(sys.argv[2], quality=92)
