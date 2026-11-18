#!/usr/bin/env python3
"""Recreate the original, redistributable geometric demo and test grid. Requires Pillow."""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parents[1]
folder=root/'examples/demo-map'
w,h=6000,7800
rx,ry=50,math.sqrt(3)*25
grid=dict(type='hex',orientation='flat-top',offset='odd-column-down',originX=0,originY=0,radiusX=rx,radiusY=ry,columnStep=75,rowStep=2*ry,minColumn=0,maxColumn=80,minRow=0,maxRow=90,bounds=dict(x=0,y=0,width=w,height=h))
fog=[f'{c},{r}' for c in range(81) for r in range(91) if (c+r)%5 != 0 and c*75<=w and (r+c%2/2)*2*ry<=h]
meta=dict(format='mapjourney-mod',version=1,revision=1,id='demo-map',name='Demo expedition',description='An original geometric demonstration map. No third-party cartography.',legacyIds=[],width=w,height=h,grid=grid,scale=dict(distance=1,unit='mi'),background='background',fog=dict(image='fog',cells=fog),assets=dict(background='background.jpg',fog='fog.jpg'),tags=[])
(folder/'map.json').write_text(json.dumps(meta,indent=2)+'\n')
(root/'tests/fixtures/synthetic-grid.json').write_text(json.dumps(dict(width=w,height=h,grid=grid,fogHexes=fog),indent=2)+'\n')
for name,bg in [('background','#c7d9bf'),('fog','#e9e6d7')]:
 im=Image.new('RGB',(600,780),bg);d=ImageDraw.Draw(im)
 if name=='background':
  d.polygon([(0,0),(230,0),(210,90),(300,210),(200,360),(270,490),(170,640),(190,780),(0,780)],fill='#9dcbd1')
  for x,y in [(390,140),(450,410),(340,600)]:
   d.polygon([(x-45,y+30),(x,y-45),(x+45,y+30)],fill='#8fa388')
 for c in range(81):
  for r in range(91):
   x,y=c*7.5,(r+c%2/2)*2*ry/10
   pts=[(x+5*math.cos(math.pi*k/3),y+ry/10*math.sin(math.pi*k/3)/math.sin(math.pi/3)) for k in range(6)]
   d.line(pts+[pts[0]], fill='#8b9e90',width=1)
 im.save(folder/f'{name}.jpg',quality=90,subsampling=0)
sys.path.insert(0,str(root/'tools'))
from prepare_campaign_tiles import generate
generate(folder)
