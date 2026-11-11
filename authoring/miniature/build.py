"""Reconstruct Moeckel Pond's mill and banks from the supplied spring reference.

The image correspondences below are in the 1280 x 720 reference view. Only
isolated surfaces supply texture images. Roofs, masonry, branches, piers,
channels and both banks are independently modeled and visible from all sides.
Requires Python 3, NumPy, Pillow, and macOS OpenUSD command-line tools.
"""
from pathlib import Path
from collections import defaultdict
import math, random, json, subprocess, sys, shutil
import numpy as np
from PIL import Image, ImageFilter

HERE=Path(__file__).resolve().parent
OUT=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else HERE.parent/'build'
OUT.mkdir(parents=True,exist_ok=True)
TEX=OUT/'textures';TEX.mkdir(exist_ok=True)
rng=random.Random(3906)
reference=Image.open(HERE/'inputs/reference.jpg').convert('RGB')
mat={};batches={};ROOT='MoeckelMill';MOVING='PondRipples'
def material(name, rgb=None, texture=None, rough=.86,metal=0):
    rgb=rgb or (255,255,255)
    linear=lambda x: x/3294.6 if x<=10 else ((x/255+.055)/1.055)**2.4
    mat[name]={'color':[linear(v) for v in rgb],'roughness':rough,'metallic':metal}
    if texture:mat[name]['texture']='textures/'+texture
    return name

def rectified(name,quad,size):
    # Project a photographed plane into a rectilinear UV image.
    w,h=size;dst=[(0,0),(w,0),(w,h),(0,h)]
    A=[];B=[]
    for (x,y),(u,v) in zip(dst,quad):
        u*=reference.width/1280;v*=reference.height/720
        A.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);B.extend([u,v])
    coeff=np.linalg.solve(A,B)
    result=reference.transform(size,Image.Transform.PERSPECTIVE,coeff,Image.Resampling.BICUBIC)
    result.save(TEX/(name+'.jpg'),quality=94,subsampling=0)
    return material(name,texture=name+'.jpg')

def crop(name,box,size=None):
    b=[round(v*reference.width/1280) for v in box];im=reference.crop(b)
    if size:im=im.resize(size,Image.Resampling.LANCZOS)
    im.save(TEX/(name+'.jpg'),quality=95,subsampling=0)
    return material(name,texture=name+'.jpg')

rectified('LongElevation',[(286,254),(737,261),(737,378),(287,379)],(1100,255))
rectified('GableElevation',[(858,79),(1156,86),(1156,388),(858,385)],(770,760))
rectified('GableReturn',[(744,251),(851,189),(851,384),(744,378)],(620,470))
rectified('BroadRoof',[(273,180),(701,197),(737,254),(282,244)],(1050,270))
# The photographed flue is replaced with shingle pixels before its 3D geometry is added.
im=Image.open(TEX/'BroadRoof.jpg')
a=np.array(im);a[:,345:536]=a[:,82:273]
Image.fromarray(a).save(TEX/'BroadRoof.jpg',quality=94,subsampling=0)
crop('BackBoards',(914,219,1111,357),(512,350))
crop('RoofSlates',(292,188,416,236),(460,180))
crop('StoneSurface',(18,410,189,466),(480,150))
crop('CellarWood',(292,382,367,434),(220,150))
rectified('MasonryLeft',[(11,402),(237,403),(237,464),(11,474)],(600,180))
for name,color,rough in [
 ('Plinth',(62,64,56),.76),('Bevel',(79,79,69),.73),('DeepWood',(34,31,25),.94),
 ('OldTimber',(76,70,57),.86),('EdgeWood',(104,98,81),.87),('Void',(21,23,18),1),
 ('Mortar',(50,53,44),.96),('Chimney',(99,80,61),.91),('FlueCap',(78,67,54),.94),
 ('BankDark',(68,72,41),.96),('BankGrass',(110,121,63),.94),
 ('FlowerWhite',(209,205,170),.87),('FlowerGold',(201,179,63),.88),('FlowerLilac',(164,137,144),.88),
 ('Bark',(82,75,52),.96),('Twig',(93,91,61),.94),('Reed',(102,106,51),.95),
 ('ReedLight',(137,140,72),.95),('ReedShade',(73,84,45),.95),('Glint',(116,133,113),.39)
]:material(name,color,rough=rough)
for i,col in enumerate([(80,93,45),(105,117,63),(120,133,71),(151,157,86),(164,166,99),(96,106,58),(136,149,83)]):
    material('Leaf'+str(i),col,rough=.92)
for i,col in enumerate([(110,103,80),(145,126,112),(157,125,137),(176,139,154),(133,111,123),(151,145,104)]):
    material('Blossom'+str(i),col,rough=.91)
for i,col in enumerate([(80,81,65),(100,99,80),(117,111,89),(124,117,97),(91,92,78),(112,111,94),(135,125,102)]):
    material('Stone'+str(i),col,rough=.97)

def poly(points,m,uv=None,double=False,group=ROOT,normals=None):
    key=(group,m,double)
    d=batches.setdefault(key,{'material':m,'points':[],'indices':[]})
    n=len(d['points']);d['points'].extend(points)
    for i in range(1,len(points)-1):d['indices'].extend([n,n+i,n+i+1])
    if 'texture' in mat[m]:
        d.setdefault('uvs',[]).extend(uv or ([(0,0),(1,0),(1,1),(0,1)] if len(points)==4 else [(0,0),(1,0),(.5,1)]))
    if double:d['doubleSided']=True
    if normals is not None:d.setdefault('normals',[]).extend(normals)

def box(x0,x1,y0,y1,z0,z1,m):
    p=[(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1),
       (x1,y0,z0),(x0,y0,z0),(x0,y1,z0),(x1,y1,z0)]
    for idx in [(0,1,2,3),(4,5,6,7),(1,4,7,2),(5,0,3,6),(3,2,7,6),(5,4,1,0)]:
        poly([p[i] for i in idx],m)

def beam(a,b,r0,r1,m,n=7):
    a=np.array(a);b=np.array(b);axis=b-a;axis/=np.linalg.norm(axis)
    ref=np.array([0.,1.,0.]) if abs(axis[1])<.94 else np.array([1.,0.,0.])
    tangent=np.cross(axis,ref);tangent/=np.linalg.norm(tangent);bitangent=np.cross(axis,tangent)
    rims=[]
    for c,r in [(a,r0),(b,r1)]:
        rims.append([c+r*(math.cos(i*math.tau/n)*tangent+math.sin(i*math.tau/n)*bitangent) for i in range(n)])
    for i in range(n):
        j=(i+1)%n;poly([rims[0][i],rims[0][j],rims[1][j],rims[1][i]],m)
    poly(list(reversed(rims[0])),m);poly(rims[1],m)

# Low object base. Side faces contain only a single solid material.
XL,XR,ZB,ZF=-.304,.363,-.652,-.148
def ring(x0,x1,z0,z1,r,y):
    out=[]
    for cx,cz,start in [(x1-r,z1-r,0),(x0+r,z1-r,90),(x0+r,z0+r,180),(x1-r,z0+r,270)]:
        for a in np.linspace(start,start+90,8):
            t=math.radians(a);out.append((cx+math.cos(t)*r,y,cz+math.sin(t)*r))
    return out
# This pond cutaway is wider along its far bank and tapers around the foreground
# island, letting the camera approach the water without cutting off the base.
outline=np.array([[-.274,-.616],[-.124,-.635],[.178,-.636],[.314,-.609],[.349,-.530],
 [.371,-.391],[.331,-.318],[.239,-.255],[.175,-.182],[.145,-.134],[.105,-.104],
 [.042,-.103],[-.026,-.115],[-.081,-.162],[-.161,-.239],[-.232,-.326],
 [-.286,-.420],[-.299,-.504],[-.289,-.580]])
def footprint(y,inset):
    # Clockwise in XZ as seen on paper; side and top faces use explicit winding.
    p=[];n=len(outline);centre=np.array([.025,-.401])
    for i in range(n):
        a,b,c,d=(outline[(i+j)%n] for j in [-1,0,1,2])
        for t in np.linspace(0.,1.,7,endpoint=False):
            xz=.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t**3)
            xz=centre+(xz-centre)*(1-inset)
            p.append((xz[0],y,xz[1]))
    return p
r0=footprint(-.011,.006);r1=footprint(-.008,0);r2=footprint(.001,0);r3=footprint(.003,.004)
for lower,upper,m in [(r0,r1,'Bevel'),(r1,r2,'Plinth'),(r2,r3,'Bevel')]:
    for i in range(len(lower)):
        j=(i+1)%len(lower);poly([lower[j],lower[i],upper[i],upper[j]],m)
poly(r0,'Plinth')
# Water albedo creates a shaded channel under the buildings. Entirely procedural; no photograph on the plinth.
N=720;xx,zz=np.meshgrid(np.linspace(XL,XR,N),np.linspace(ZB,ZF,N))
noise=np.random.default_rng(21).random((N,N))
def mist(cx,cz,ax,az):return np.exp(-((xx-cx)/ax)**4-((zz-cz)/az)**2)
wave=np.sin(zz*1020+np.sin(xx*71)*3+np.sin(xx*137+zz*88))*.5+np.sin(zz*1734+xx*63)*.23
channel=mist(.192,-.315,.087,.097)*.79+mist(-.005,-.477,.136,.06)*.54
warm=mist(-.215,-.46,.079,.13)+.7*mist(.316,-.372,.06,.09)
refl=.5+.5*np.sin(xx*288+np.sin(zz*160)*1.5)
base=np.array([67.,87.,80.]);rgb=np.broadcast_to(base,(N,N,3)).copy()
rgb += (wave*5+(noise-.5)*3+refl*5)[:,:,None]
rgb *= (1-np.minimum(.85,channel)*.68)[:,:,None]
rgb += warm[:,:,None]*np.array([7.,5.,-7.])
Image.fromarray(np.uint8(np.clip(rgb,0,255))).save(TEX/'Water.jpg',quality=94)
material('PondWater',texture='Water.jpg',rough=.39,metal=.16)
water=list(reversed(r3));poly(water,'PondWater',[((x-XL)/(XR-XL),1-(z-ZB)/(ZF-ZB)) for x,y,z in water])
# Animating fine, broken reflections keeps the building stationary.
def within_water(x,z):
    # All vertices of the wavelet must remain over the pond at each animation extremum.
    inside=False
    for i,p in enumerate(r3):
        q=r3[(i+1)%len(r3)]
        if (p[2]>z)!=(q[2]>z):
            if x<(q[0]-p[0])*(z-p[2])/(q[2]-p[2])+p[0]:inside=not inside
    return inside
for i in range(85):
    x=rng.uniform(XL+.026,XR-.026);z=rng.uniform(-.48,ZF-.018)
    if not all(within_water(x+dx,z+dz) for dx in [-.016,.016] for dz in [-.004,.004]):continue
    length=rng.uniform(.003,.012);y=.00328
    p=[(x-length,y,z),(x-length*.22,y+.00007,z-.00021),(x+length,y,z+.00013),(x,y,z+.00023)]
    poly(p,'Glint',double=True,group=MOVING)

# Central two-volume mill. The gable's blank front faces +Z; its long LEFT return faces -X.
X0,X1,Z0,Z1=.124,.255,-.607,-.320
floor,eave,ridge=.044,.128,.182;mid=(X0+X1)/2
V=(eave-floor)/(ridge-floor)
poly([(X0,floor,Z1),(X1,floor,Z1),(X1,eave,Z1),(mid,ridge,Z1),(X0,eave,Z1)],
     'GableElevation',[(0,0),(1,0),(1,V),(.47,1),(0,V)])
poly([(X1,floor,Z0),(X0,floor,Z0),(X0,eave,Z0),(mid,ridge,Z0),(X1,eave,Z0)],
     'BackBoards',[(0,0),(1.4,0),(1.4,1.2),(.7,1.85),(0,1.2)])
wing_front=-.472
poly([(X0,floor,Z0),(X0,floor,wing_front),(X0,eave,wing_front),(X0,eave,Z0)],'BackBoards',[(0,0),(1.2,0),(1.2,1),(0,1)])
poly([(X0,floor,wing_front),(X0,floor,Z1),(X0,eave,Z1),(X0,eave,wing_front)],'GableReturn')
poly([(X1,floor,Z1),(X1,floor,Z0),(X1,eave,Z0),(X1,eave,Z1)],'BackBoards',[(0,0),(2.1,0),(2.1,1.2),(0,1.2)])
box(X0,X1,floor-.0014,floor,Z0,Z1,'DeepWood')
def roof(name, corners,tex):
    poly(corners,tex)
    under=[(x,y-.0018,z) for x,y,z in corners];poly(list(reversed(under)),'DeepWood')
    for i in range(4):
        j=(i+1)%4;poly([corners[j],corners[i],under[i],under[j]],'EdgeWood')
pad=.0035
roof('MainLeft',[(X0-pad,eave,Z1+pad),(mid,ridge+.001,Z1+pad),(mid,ridge+.001,Z0-pad),(X0-pad,eave,Z0-pad)],'RoofSlates')
roof('MainRight',[(mid,ridge+.001,Z1+pad),(X1+pad,eave,Z1+pad),(X1+pad,eave,Z0-pad),(mid,ridge+.001,Z0-pad)],'RoofSlates')
# Main gable fascia and weathered corner uprights are narrow enough to preserve the photo's silhouette.
for x in [X0,X1]:box(x-.00065,x+.00065,floor,eave,Z1,Z1+.0007,'EdgeWood')

# Left wing runs along X with a full-width shingled roof pitched toward the viewer.
L,R=-.126,.125;zF=wing_front;zB=-.604;zM=(zF+zB)/2
low,high,apex=.041,.102,.137
windows=[(.486,.528,.235,.565),(.704,.749,.230,.565),(.486,.529,.72,.982),(.704,.749,.72,.984)]
us=sorted({0.,1.,*(v for w in windows for v in w[:2])});vs=sorted({0.,1.,*(v for w in windows for v in w[2:])})
def frontpos(u,v,z=zF):return (L+(R-L)*u,low+(high-low)*v,z)
def surface_panel(u0,u1,v0,v1,z,elevation):
    uv=[(u0,v0),(u1,v0),(u1,v1),(u0,v1)]
    poly([frontpos(u,v,z) for u,v in uv],elevation,uv)
for ua,ub in zip(us,us[1:]):
    for va,vb in zip(vs,vs[1:]):
        if any(a<(ua+ub)/2<b and c<(va+vb)/2<d for a,b,c,d in windows):continue
        surface_panel(ua,ub,va,vb,zF,'LongElevation')
for a,b,c,d in windows:
    recess=.0013;surface_panel(a,b,c,d,zF-recess,'LongElevation')
    outer=[frontpos(a,c),frontpos(b,c),frontpos(b,d),frontpos(a,d)]
    inner=[(x,y,z-recess) for x,y,z in outer]
    for i in range(4):j=(i+1)%4;poly([outer[i],outer[j],inner[j],inner[i]],'DeepWood',double=True)
    x0,y0,_=outer[0];x1=outer[1][0]
    box(x0-.0006,x1+.0006,y0-.0007,y0,zF-.0003,zF+.001,'EdgeWood')
poly([(R,low,zB),(L,low,zB),(L,high,zB),(R,high,zB)],'BackBoards',[(0,0),(2.2,0),(2.2,1),(0,1)])
poly([(L,low,zB),(L,low,zF),(L,high,zF),(L,apex,zM),(L,high,zB)],'BackBoards',[(0,0),(1.4,0),(1.4,.7),(.7,1.1),(0,.7)])
poly([(R,low,zF),(R,low,zB),(R,high,zB),(R,apex,zM),(R,high,zF)],'BackBoards',[(0,0),(1.4,0),(1.4,.7),(.7,1.1),(0,.7)])
box(L,R,low-.0015,low,zB,zF,'DeepWood')
roof('WingFront',[(L-pad,high,zF+pad),(R+pad,high,zF+pad),(R+pad,apex,zM),(L-pad,apex,zM)],'BroadRoof')
roof('WingBack',[(R+pad,high,zB-pad),(L-pad,high,zB-pad),(L-pad,apex,zM),(R+pad,apex,zM)],'RoofSlates')
# Small chimney visible just down from the left ridge.
fx=L+(R-L)*.411;fz=zM+.018;fy=apex-(fz-zM)/(zF-zM)*(apex-high)
box(fx-.0041,fx+.0041,fy-.001,fy+.0135,fz-.0036,fz+.0036,'Chimney')
box(fx-.0048,fx+.0048,fy+.0130,fy+.015,fz-.0044,fz+.0044,'FlueCap')
box(L,L+.051,.004,low,zB,zF,'CellarWood')
# Dark interior surfaces at the back of actual open bays.
box(X0+.003,X1-.003,.002,floor-.001,Z1-.071,Z1-.060,'Void')
box(X0+.018,X0+.022,.002,floor-.001,wing_front+.003,Z1-.044,'Void')
box(L+.048,R-.001,.002,low-.001,zF-.046,zF-.036,'Void')
for x in [-.057,-.014,.032,.075]:
    box(x,x+.0021,.003,low,zF-.012,zF-.009,'OldTimber')
box(L,R,low-.004,low,zF-.002,zF+.0003,'DeepWood')

# Rough, individually coursed granite supports. Each block has slight variations in face, depth and height.
def stone_block(a,b,y0,y1,c,d,shade=None):
    # Chamfered, uneven granite faces follow the joint courses in the source.
    w=b-a;h=y1-y0;cut=min(w*.19,h*.27);dz=d-c
    rim=[(a+cut,y0),(b-cut*.7,y0),(b,y0+cut*.7),(b,y1-cut),(b-cut*.8,y1),
         (a+cut*1.35,y1),(a,y1-cut*.63),(a,y0+cut)]
    front=[(x+rng.uniform(-.00032,.00032),y+rng.uniform(-.00046,.00046),d+rng.uniform(-.00065,.00065)) for x,y in rim]
    back=[(x+rng.uniform(-.00045,.00045),y,c+rng.uniform(-.00045,.00045)) for x,y,z in front]
    u,v=rng.uniform(.04,.65),rng.uniform(.035,.58);du,dv=rng.uniform(.12,.27),rng.uniform(.18,.34)
    uv=[(u+(x-a)/w*du,v+(y-y0)/h*dv) for x,y,_ in front]
    poly(front,'StoneSurface',uv);poly(list(reversed(back)),'StoneSurface',list(reversed(uv)))
    for i in range(len(front)):
        j=(i+1)%len(front)
        poly([front[j],front[i],back[i],back[j]],'StoneSurface',[(u+du,v),(u,v),(u,v+dv),(u+du,v+dv)])

def masonry(x0,x1,z0,z1,y0,y1,rows,block_width,face=None):
    # Dark recessed mortar remains visible in joints, while the stones cast their own shadows.
    box(x0+.001,x1-.001,y0,y1-.0002,z0+.0008,z1-.0016,'Mortar')
    for row in range(rows):
        a=y0+(y1-y0)*row/rows;b=y0+(y1-y0)*(row+1)/rows
        x=x0
        while x<x1-.0003:
            w=min(x1-x,block_width*rng.uniform(.65,1.3)*(0.6 if row%2 and x==x0 else 1))
            if x1-(x+w)<block_width*.32:w=x1-x
            gap=.00026
            depth=z0
            while depth<z1-.00015:
                d=min(z1-depth,rng.uniform(.0125,.021))
                if z1-(depth+d)<.005:d=z1-depth
                stone_block(x+gap,x+w-gap,a+.0001,b,depth+.00014,depth+d-.00014)
                depth+=d
            x+=w
    # Apply the photographed granite courses to exposed side returns and the cap.
    # Cropping by physical dimensions keeps side stones at the same scale as front masonry.
    h=y1-y0;d=z1-z0;w=x1-x0;skim=.0011
    vv=h/.046;ud=d/.132;uw=w/.132
    poly([(x0-skim,y0,z0),(x0-skim,y0,z1),(x0-skim,y1,z1),(x0-skim,y1,z0)],'StoneSurface',[(.08,.02),(.08+ud,.02),(.08+ud,.02+vv),(.08,.02+vv)])
    poly([(x1+skim,y0,z1),(x1+skim,y0,z0),(x1+skim,y1,z0),(x1+skim,y1,z1)],'StoneSurface',[(.49,.08),(.49+ud,.08),(.49+ud,.08+vv),(.49,.08+vv)])
    poly([(x0,y1+.0008,z1),(x1,y1+.0008,z1),(x1,y1+.0008,z0),(x0,y1+.0008,z0)],'StoneSurface',[(.19,.13),(.19+uw,.13),(.19+uw,.13+d/.046),(.19,.13+d/.046)])
    if face:
       # Thin photo-mapped relief skin across the main outward face; no flat backing under its open channels.
       nx,ny=34,10
       for iy in range(ny):
        for ix in range(nx):
         uv=[(ix/nx,iy/ny),((ix+1)/nx,iy/ny),((ix+1)/nx,(iy+1)/ny),(ix/nx,(iy+1)/ny)]
         def relief(u,v):return z1+.0017
         poly([(x0+(x1-x0)*u,y0+(y1-y0)*v,relief(u,v)) for u,v in uv],face,uv)
for i,(a,b) in enumerate([(-.018,.235),(.345,.575),(.809,1.008)]):
    x0=X0+(X1-X0)*a;x1=X0+(X1-X0)*b
    tex=rectified('FrontPier'+str(i),[
      [(842,394),(915,395),(921,486),(839,489)],[(958,394),(1023,394),(1033,481),(957,484)],[(1099,394),(1155,393),(1155,471),(1105,475)]][i],(220,248))
    masonry(x0,x1,Z1-.038,Z1-.0008,.0008,floor-.001,6,.013,tex)
    masonry(x0,x1,Z0+.028,Z0+.061,.001,floor-.001,6,.014)
for x in [X0-.001,X1-.018]:masonry(x,x+.020,-.451,-.422,.001,floor,5,.014)
masonry(L+.051,L+.076,zF-.038,zF,.003,low-.001,5,.013)
masonry(.087,.119,-.464,-.419,.002,.041,6,.013)
masonry(.092,.122,-.471,-.438,.041,.053,2,.013)
# Left retaining wall, fully exposed on the outside of the left wing.
masonry(XL+.008,L-.001,-.513,-.455,.002,.033,5,.023,'MasonryLeft')
# Short left-side walk and posts on the wing's outside corner.
box(L-.015,L,.039,.041,-.518,-.475,'OldTimber')
for z in [-.513,-.483]:
    box(L-.016,L-.014,.041,.055,z-.001,z+.001,'OldTimber')
box(L-.0165,L-.0135,.0538,.055,-.515,-.481,'EdgeWood')

# Waterside plants and terrain. The meadow's long axis is left/back to right/front (+X,+Z).
def meadow(t,s):
    a=np.array([-.166,-.436]);b=np.array([-.045,-.407]);c=np.array([.060,-.255]);d=np.array([.107,-.136])
    xy=(1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d
    tangent=3*(1-t)**2*(b-a)+6*(1-t)*t*(c-b)+3*t*t*(d-c)
    norm=np.array([-tangent[1],tangent[0]])/np.linalg.norm(tangent)
    width=(max(0,math.sin(t*math.pi))**.55)*(.026+.016*t+.015*math.exp(-((t-.70)/.19)**2))*(1+.11*math.sin(t*20)+.065*math.sin(t*37))
    xy+=norm*width*s
    y=.00315+.0135*(1-s*s)*max(0,math.sin(t*math.pi))**.70 + .0007*math.sin(22*t+5*s)
    return (xy[0],y,xy[1])

def shore_texture():
    # Isolated meadow detail in the foreground of the reference, mottled across the ground.
    raw=reference.crop((591,766,725,826)).resize((256,128),Image.Resampling.LANCZOS).convert('RGB')
    arr=np.asarray(raw,dtype=float)
    luminance=arr.mean(axis=2);luminance=(luminance-luminance.mean())*.32
    n=np.random.default_rng(70).normal(0,5,luminance.shape)
    result=np.uint8(np.clip(np.array([61,75,37])+(luminance+n)[:,:,None],0,255))
    Image.fromarray(result).save(TEX/'MeadowGround.jpg',quality=92)
    material('MeadowGround',texture='MeadowGround.jpg',rough=.98)
shore_texture()
for i in range(55):
    t0=i/55;t1=(i+1)/55
    for j in range(8):
        s0=-1+j/4;s1=s0+.25
        # Transverse (s) then longitudinal (t) winding gives +Y.
        uv=[(t0*8,j/8),(t0*8,(j+1)/8),(t1*8,(j+1)/8),(t1*8,j/8)]
        poly([meadow(t0,s0),meadow(t0,s1),meadow(t1,s1),meadow(t1,s0)],'MeadowGround',uv,double=True)
def blade(x,y,z,h,m):
    w=h*rng.uniform(.035,.095);a=rng.random()*math.tau;dx=math.cos(a)*w;dz=math.sin(a)*w
    poly([(x-dx,y,z-dz),(x+dx,y,z+dz),(x+rng.uniform(-h*.4,h*.4),y+h,z+rng.uniform(-h*.3,h*.3))],m,double=True)
for _ in range(3600):
    t=rng.uniform(.013,.99);s=rng.uniform(-1,1);x,y,z=meadow(t,s)
    blade(x,y,z,rng.uniform(.0014,.0069),rng.choice(['Reed','ReedShade','ReedLight']))
for _ in range(925):
    t=rng.uniform(.022,.98);s=rng.uniform(-.91,.91);x,y,z=meadow(t,s)
    high=rng.uniform(.0022,.008);w=rng.uniform(.00042,.00093)*(1+.3*t);y+=high
    m=rng.choices(['FlowerWhite','FlowerGold','FlowerLilac'],[.41+.25*math.sin(26*t),.41+.33*math.cos(21*t),.38+.30*math.sin(t*16)])[0]
    bud=[(x-w,y,z),(x,y+w*.65,z+w*.62),(x+w,y,z),(x,y-w*.65,z+w*.26)]
    petal=(x,y+w*.38,z-w*.49)
    for k in range(4):poly([bud[k],bud[(k+1)%4],petal],m,double=True)
    if rng.random()<.46:blade(x,y-high,z,high,'Reed')

# Sculpted bank masses occupy the extreme edges and the area behind the building.
def mound(cx,cz,rx,rz,height,material_name):
    rings=32
    prev=None
    for j in range(7):
        radius=j/6
        cur=[]
        for i in range(rings):
            a=math.tau*i/rings;ruffle=1+.045*math.sin(5*a+cx*20)+.025*math.cos(9*a)
            cur.append((cx+rx*radius*math.cos(a)*ruffle,.003+height*(1-radius**3)+.00035*math.sin(a*5)*radius,cz+rz*radius*math.sin(a)*ruffle))
        if prev is not None:
            for i in range(rings):
                k=(i+1)%rings;face=[prev[i],prev[k],cur[k],cur[i]]
                poly(face,material_name,[((v[0]-cx)*17,(v[2]-cz)*17) for v in face])
        prev=cur
mound(-.207,-.530,.079,.055,.031,'MeadowGround')
mound(.312,-.384,.041,.063,.012,'MeadowGround')
mound(-.008,-.590,.142,.033,.013,'MeadowGround')
# The rural retaining wall spans the left shoreline. Keep the lawn behind its face.
for i in range(270):
    x=rng.uniform(XL+.014,L-.011);z=rng.uniform(-.513,-.466)
    blade(x,.0327,z,rng.uniform(.0018,.0055),rng.choice(['Reed','ReedShade','ReedLight']))

def leaf(x,y,z,amount,m):
    size=amount; angle=rng.uniform(0,math.tau)
    long=np.array([math.cos(angle),rng.uniform(-.65,.75),math.sin(angle)])*size
    across=np.array([-math.sin(angle),rng.uniform(-.25,.30),math.cos(angle)])*size*rng.uniform(.33,.52)
    center=np.array([x,y,z]);peak=center+np.array([0,.00024,0])
    ends=[center-long,center+across,center+long,center-across]
    for i in range(4):poly([ends[i],ends[(i+1)%4],peak],m,double=True)

def foliage_texture(name,box,mode):
    region=reference.crop(tuple(round(v*reference.width/1280) for v in box)).resize((256,256),Image.Resampling.LANCZOS)
    rgb=np.asarray(region,dtype=float)
    # Recover the canopy's fine photographic leaf pattern while removing sky holes.
    invalid=(rgb[:,:,2]>rgb[:,:,0]*1.15)|(rgb.mean(axis=2)>196)
    original=rgb.copy()
    for _ in range(32):
        if not invalid.any(): break
        total=np.zeros_like(rgb);weights=np.zeros(invalid.shape)
        for dy,dx in [(1,0),(-1,0),(0,1),(0,-1),(2,2),(-2,-2)]:
            ok=np.roll(~invalid,(dy,dx),(0,1));val=np.roll(rgb,(dy,dx),(0,1))
            total+=val*ok[:,:,None];weights+=ok
        take=invalid&(weights>0);rgb[take]=total[take]/weights[take,None];invalid[take]=False
    if invalid.any():rgb[invalid]=np.array([97,114,65] if mode=='leaf' else [144,118,124])
    tone=rgb.mean(axis=2);tone=(tone-np.median(tone))*.49
    target=np.array({'leaf':[99,117,62],'young':[132,148,91],'blossom':[151,126,135]}[mode])
    rgb=np.uint8(np.clip(target+tone[:,:,None],0,255));Image.fromarray(rgb).save(TEX/(name+'.jpg'),quality=91)
    material(name,texture=name+'.jpg',rough=.93)
foliage_texture('WillowFoliage',(32,151,119,301),'leaf')
foliage_texture('BlossomFoliage',(1230,307,1278,417),'blossom')
foliage_texture('YoungFoliage',(1176,259,1222,356),'young')

def leaf_cluster(center,width,height,m):
    steps=10;levels=6;rings=[]
    yaw=rng.uniform(0,math.tau)
    for j in range(levels+1):
        lat=-math.pi/2+j*math.pi/levels;ring=[]
        for i in range(steps):
            a=i*math.tau/steps+yaw;noise=rng.uniform(.76,1.16)
            ring.append((center[0]+math.cos(a)*math.cos(lat)*width*noise,
                         center[1]+math.sin(lat)*height*noise,
                         center[2]+math.sin(a)*math.cos(lat)*width*noise*.82))
        rings.append(ring)
    for j in range(levels):
        for i in range(steps):
            k=(i+1)%steps
            face=[rings[j][k],rings[j][i],rings[j+1][i],rings[j+1][k]]
            normals=[]
            for vertex in face:
                vector=(np.array(vertex)-center)/np.array([width*width,height*height,(width*.82)**2])
                vector=vector/np.linalg.norm(vector);normals.append(vector.tolist())
            poly(face,m,[((i+1)/steps,j/levels),(i/steps,j/levels),(i/steps,(j+1)/levels),((i+1)/steps,(j+1)/levels)],normals=normals)
def tree(cx,cz,height,spread,flowering=False,delicate=False):
    ground=.009 if flowering or delicate else .033
    leaves=['Blossom'+str(i) for i in range(6)] if flowering else ['Leaf'+str(i) for i in range(7)]
    stems=2 if delicate else 3 if flowering else 4
    for j in range(stems):
        az=j*math.tau/stems+.4
        start=np.array([cx+rng.uniform(-.004,.004),ground,cz+rng.uniform(-.004,.004)])
        head=start+np.array([math.cos(az)*spread*.20,height*rng.uniform(.49,.69),math.sin(az)*spread*.18])
        beam(start,head,height*.017,height*.008,'Bark',6)
        for k in range(6 if delicate else 9):
            t=rng.uniform(.31,.99);root=start+(head-start)*t
            a=az+rng.uniform(-1.5,1.5)
            terminal=np.array([cx+math.cos(a)*spread*rng.uniform(.32,.90),ground+height*rng.uniform(.47,.96),cz+math.sin(a)*spread*rng.uniform(.3,.88)])
            elbow=(terminal+root)*.5+np.array([0,-height*.04,0])
            beam(root,elbow,height*.009,height*.0042,'Bark',5)
            beam(elbow,terminal,height*.0042,height*.0015,'Twig',5)
            for _ in range(4):
                v=rng.uniform(.45,1);twig=elbow+(terminal-elbow)*v
                tip=twig+np.array([rng.uniform(-.24,.24)*spread,rng.uniform(.01,.14)*height,rng.uniform(-.22,.22)*spread])
                beam(twig,tip,height*.0027,height*.0011,'Twig',4)
                width=spread*rng.uniform(.09,.15) if delicate else spread*rng.uniform(.14,.225)
                leaf_cluster(tip,width,width*rng.uniform(.72,1.15),'YoungFoliage' if delicate else 'BlossomFoliage' if flowering else 'WillowFoliage')
                for _ in range(14 if delicate else 26 if not flowering else 18):
                    pos=tip+np.array([rng.gauss(0,spread*.115),rng.gauss(0,height*.044),rng.gauss(0,spread*.115)])
                    leaf(*pos,rng.uniform(.0014,.00265) if not flowering else rng.uniform(.0011,.00215),rng.choice(leaves))
tree(-.231,-.529,.124,.057)
tree(.333,-.365,.067,.027,True)
tree(.345,-.393,.096,.023,delicate=True)

# Convert to physical tabletop dimensions and make the reference view face +Z
# on launch. A six-degree yaw presents the main building's LEFT return wall in Quick Look.
SCALE=.475;xc=(XL+XR)/2;zc=(ZF+ZB)/2;angle=math.radians(7);c=math.cos(angle);ss=math.sin(angle)
def placed(p):
    x,y,z=p;x-=xc;z-=zc
    return [round(SCALE*(c*x+ss*z),7),round(SCALE*(y+.011),7),round(SCALE*(-ss*x+c*z),7)]
nodes=[{'name':ROOT},{'name':MOVING,'parent':ROOT,'animation':{'translation':True,'times':[0,2,4,6,8],'values':[[0,0,0],[.00055,0,.0003],[0,0,.00062],[-.00055,0,.0003],[0,0,0]]}}]
for (group,m,double),geom in batches.items():
    geom['points']=[placed(p) for p in geom['points']]
    if geom.get('normals'):
        geom['normals']=[[round(c*x+ss*z,7),round(y,7),round(-ss*x+c*z,7)] for x,y,z in geom['normals']]
    nodes.append({'name':group+m+('Foliage' if double else 'Surface'),'parent':group,'mesh':geom})
# Calibrate the photographed perspective from a camera near the surface.
# Fit the entire silhouette in the browser by changing focal length on resize.
points=np.vstack([np.asarray(n['mesh']['points']) for n in nodes if 'mesh' in n])
eye=np.asarray(placed((.000,.090,.045)));aim=np.asarray(placed((.049,.063,-.395)))
for _ in range(8):
    forward=aim-eye;dist=np.linalg.norm(forward);forward/=dist
    right=np.cross(forward,[0.,1.,0.]);right/=np.linalg.norm(right);up=np.cross(right,forward)
    rel=points-eye;depth=np.einsum('ij,j->i',rel,forward)
    u=np.einsum('ij,j->i',rel,right)/depth;v=np.einsum('ij,j->i',rel,up)/depth
    aim+=(right*(u.max()+u.min())+up*(v.max()+v.min()))*.36*dist
hero={'eye':eye.tolist(),'target':aim.tolist(),'tanX':float(np.max(np.abs(u))),
      'tanY':float(np.max(np.abs(v))),'islandEnds':[placed(meadow(0,0)),placed(meadow(1,0))]}
(OUT/'view.json').write_text(json.dumps(hero,indent=2))
scene={'materials':mat,'nodes':nodes,'duration':8,'hero':hero}
(OUT/'scene.json').write_text(json.dumps(scene,separators=(',',':')))
from export_usd import write_usdz
write_usdz(scene, OUT)
subprocess.run([sys.executable,str(HERE/'export_glb.py'),str(OUT/'scene.json'),str(OUT/'pond.glb')],check=True)
print('Finished',len(nodes),'groups,',sum(len(n['mesh']['indices'])//3 for n in nodes if 'mesh' in n),'triangles')
