"""Author an original-resolution 24fps native wall film from real decoded RGB frames.

A patch is held only while its RMS difference from the new source patch stays
within 5.8 levels out of 255. A second local check preserves small moving details.
Each accepted patch gets an atlas tile and one rigid USD joint. The stage, film
and losslessly remuxed stereo audio share the original 24 fps timeline.
"""
import json, math, subprocess, shutil
from pathlib import Path
import numpy as np
from PIL import Image
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("film",type=Path,help="Original Moeckel Pond Seasons 960x540/24fps MP4")
parser.add_argument("destination",type=Path,help="Build directory for the native wall-film package")
args=parser.parse_args()
source=args.film.resolve()
ffmpeg=shutil.which("ffmpeg")
if ffmpeg is None:
    import imageio_ffmpeg
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
def ff(*args):
    return [ffmpeg,"-v","error","-nostdin","-y",*args]
def arr(v):return '['+', '.join(map(str,v))+']'
def vec(v):return '('+', '.join(f'{x:.8g}' for x in v)+')'
def attrs_mesh(points,idx,mat,uv=None):
    lines=[f'point3f[] points = {arr(vec(p) for p in points)}',
           'int[] faceVertexCounts = '+arr([3]*(len(idx)//3)),
           'int[] faceVertexIndices = '+arr(idx),
           'uniform token subdivisionScheme = "none"',
           f'rel material:binding = </MoeckelPondFilm/Materials/{mat}>']
    if uv:lines.append('texCoord2f[] primvars:st = '+arr(vec(p) for p in uv)+' (interpolation = "vertex")')
    return '\n'.join(lines)

def material(name,col,rough,file=None,metal=0):
    p=f'/MoeckelPondFilm/Materials/{name}'
    lines=[f'def Material "{name}" {{',f'token outputs:surface.connect = <{p}/Surface.outputs:surface>',
        'def Shader "Surface" {','uniform token info:id = "UsdPreviewSurface"',
        f'color3f inputs:diffuseColor = {vec(col)}',f'float inputs:roughness = {rough}',f'float inputs:metallic = {metal}',
        f'color3f inputs:emissiveColor.connect = <{p}/Texture.outputs:rgb>' if file else '',
        'token outputs:surface','}']
    if file:
        lines.extend(['def Shader "UV" {','uniform token info:id = "UsdPrimvarReader_float2"',
                      'string inputs:varname = "st"','float2 outputs:result','}',
                      'def Shader "Texture" {','uniform token info:id = "UsdUVTexture"',
                      f'asset inputs:file = @{file}@','token inputs:sourceColorSpace = "sRGB"',
                      'token inputs:wrapS = "clamp"','token inputs:wrapT = "clamp"',
                      f'float2 inputs:st.connect = <{p}/UV.outputs:result>','float3 outputs:rgb','}'])
    return '\n'.join(lines+['}'])
IDENTITY='((1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))'


root=args.destination.resolve()
tex=root/'textures'
root.mkdir(parents=True,exist_ok=True);tex.mkdir(exist_ok=True)
W,H=960,540
NX,NY=6,5
TW,TH=W//NX,H//NY
G=2
SW,SH=TW+2*G,TH+2*G
SHEET_COLS=8
PAGE=64
rms_limit=5.8
peakblock_limit=31.0
total=995

def decode():
    cmd=ff('-i',str(source),'-an','-map','0:v:0','-pix_fmt','rgb24','-f','rawvideo','pipe:1')
    proc=subprocess.Popen(cmd,stdout=subprocess.PIPE)
    memo=np.zeros((NX*NY,TH,TW,3),dtype='float32')
    entries=[];active=[None]*(NX*NY);schedule=[]
    peak_held=0
    frame=0
    while True:
        data=proc.stdout.read(W*H*3)
        if not data:break
        rgb=np.frombuffer(data,np.uint8).reshape(H,W,3)
        if frame==0:Image.fromarray(rgb).save(tex/'opening.jpg',quality=94)
        patches=rgb.reshape(NY,TH,NX,TW,3).transpose(0,2,1,3,4).reshape(NY*NX,TH,TW,3)
        difference=patches.astype('float32')-memo
        squared=np.mean(difference*difference,axis=3)
        rms2=squared.mean(axis=(1,2))
        region_rms2=squared.reshape(NY*NX,9,12,10,16).mean(axis=(2,4)).max(axis=(1,2))
        changed=np.ones(NX*NY,dtype=bool) if frame==0 else (rms2>rms_limit**2)|(region_rms2>peakblock_limit**2)
        if (~changed).any():peak_held=max(peak_held,float(np.sqrt(rms2[~changed].max())))
        for slot in np.flatnonzero(changed):
            slot=int(slot)
            if active[slot] is not None:entries[active[slot]]['end']=frame
            entry={'slot':slot,'start':frame,'end':total,'rgb':patches[slot].copy()}
            active[slot]=len(entries);entries.append(entry);memo[slot]=patches[slot]
        schedule.append(active.copy());frame+=1
    if proc.wait() or frame!=total:raise ValueError('Unexpected source video')
    print('Encoded patches:',len(entries),'largest held patch RMS:',peak_held)
    return entries,schedule

def pack(page,entries):
    height=math.ceil(len(entries)/SHEET_COLS)*SH
    width=SHEET_COLS*SW
    atlas=np.empty((height,width,3),dtype='uint8');atlas[:]=0
    for i,e in enumerate(entries):
        col,row=i%SHEET_COLS,i//SHEET_COLS
        x,y=col*SW,row*SH
        # Duplicate edge pixels into a 2px gutter to protect minification filtering.
        atlas[y:y+SH,x:x+SW]=np.pad(e['rgb'],((G,G),(G,G),(0,0)),mode='edge')
    Image.fromarray(atlas).save(tex/f'frames-{page:02}.jpg',quality=88,subsampling=2,optimize=True)
    return width,height

def per_page(pg,entries):
    width,height=pack(pg,entries)
    path=f'/MoeckelPondFilm/Strip{pg:02}'
    count=len(entries);joints=arr(json.dumps(s) for s in ['Root']+[f'Root/T{i}' for i in range(count)])
    pts=[];idx=[];uv=[];indices=[]
    changes={}
    for i,e in enumerate(entries):
        x=(i%SHEET_COLS)*SW+G;y=(i//SHEET_COLS)*SH+G
        u0,u1=x/width,(x+TW)/width
        v0,v1=1-(y+TH)/height,1-y/height
        uv.extend([(u0,v0),(u1,v0),(u1,v1),(u0,v1)])
        col,row=e['slot']%NX,e['slot']//NX
        left=(col/NX-.5)*.584;right=((col+1)/NX-.5)*.584
        top=(row/NY-.5)*.3285;bottom=((row+1)/NY-.5)*.3285
        pts.extend([(left,.016,bottom),(right,.016,bottom),(right,.016,top),(left,.016,top)])
        idx.extend([4*i+j for j in (0,1,2,0,2,3)]);indices.extend([i+1]*4)
        changes.setdefault(e['start'],[]).append((i,True))
        if e['end']<total:changes.setdefault(e['end'],[]).append((i,False))
    active=set();samples=[]
    def add(t):
        translations=['(0, 0, 0)']*(count+1)
        for i in active:translations[i+1]='(0, 0.004, 0)'
        samples.append(f'{t:.6f}: '+arr(translations))
    if 0 not in changes:add(0)
    for t,events in sorted(changes.items()):
        if t>0:add(t-.002)
        for index,visible in events:
            if visible:active.add(index)
            else:active.discard(index)
        add(t)
    add(total)
    sample_text=',\n'.join(samples)
    fields=attrs_mesh(pts,idx,f'Page{pg:02}',uv)
    return width,height,f'''def SkelRoot "Strip{pg:02}" {{
 def Skeleton "Skeleton" (prepend apiSchemas = ["SkelBindingAPI"]) {{
    uniform token[] joints = {joints}
    uniform matrix4d[] bindTransforms = {arr([IDENTITY]*(count+1))}
    uniform matrix4d[] restTransforms = {arr([IDENTITY]*(count+1))}
    rel skel:animationSource = <{path}/FilmFrames>
 }}
 def SkelAnimation "FilmFrames" {{
    uniform token[] joints = {joints}
    quatf[] rotations = {arr(['(1, 0, 0, 0)']*(count+1))}
    half3[] scales = {arr(['(1, 1, 1)']*(count+1))}
    float3[] translations.timeSamples = {{
{sample_text}
    }}
 }}
 def Mesh "Film" (prepend apiSchemas = ["SkelBindingAPI","MaterialBindingAPI"]) {{
 {fields}
 rel skel:skeleton = <{path}/Skeleton>
 matrix4d primvars:skel:geomBindTransform = {IDENTITY}
 int[] primvars:skel:jointIndices = {arr(indices)} (
    interpolation = "vertex"
    elementSize = 1
 )
 float[] primvars:skel:jointWeights = {arr([1]*len(indices))} (
    interpolation = "vertex"
    elementSize = 1
 )
 }}
}}'''

def main():
    entries,schedule=decode()
    chunks=[per_page(pg,entries[start:start+PAGE]) for pg,start in enumerate(range(0,len(entries),PAGE))]
    materials=[material(f'Page{pg:02}',(0,0,0),1,f'textures/frames-{pg:02}.jpg') for pg in range(len(chunks))]
    template=(Path(__file__).resolve().parent/'frame.usda.in').read_text()
    stage=template.replace('{{FILM_MATERIALS}}','\n'.join(materials)).replace('{{FILM_ANIMATION}}','\n'.join(x[2] for x in chunks))
    (root/'WallFilm.usda').write_text(stage)
    subprocess.run(ff('-i',str(source),'-map','0:a:0','-vn','-c:a','copy',str(root/'soundtrack.m4a')),check=True)
    subprocess.run(['usdcat','WallFilm.usda','-o','WallFilm.usdc'],cwd=root,check=True)
    out='moeckel-wall-film.usdz'
    subprocess.run(['usdzip',out,'WallFilm.usdc','soundtrack.m4a','textures/opening.jpg',*[f'textures/frames-{i:02}.jpg' for i in range(len(chunks))]],cwd=root,check=True)
    subprocess.run(['usdchecker','--arkit','--strict',out],cwd=root,check=True)
    statistics={'width':W,'height':H,'fps':24,'frames':total,'patches':len(entries),'patchGrid':[NX,NY],
                'sheets':len(chunks),'baseTextureMiB':sum(w*h*4 for w,h,_ in chunks)/2**20,
                'packageBytes':(root/out).stat().st_size,'boundRMS':rms_limit}
    print(statistics)
    (root/'stats.json').write_text(json.dumps(statistics,indent=2))
    (root/'verify').mkdir(exist_ok=True)
    (root/'verify'/'patch-times.json').write_text(json.dumps({'entries':[{k:e[k] for k in ('slot','start','end')} for e in entries],'schedule':schedule},separators=(',',':')))
if __name__=='__main__': main()
