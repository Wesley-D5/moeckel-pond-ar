"""Generate the Season Mill. Run with Python 3, Pillow and the OpenUSD command line tools."""
from pathlib import Path
from math import sin, cos, pi, sqrt, exp
import json
import random
import subprocess
from PIL import Image, ImageEnhance, ImageOps, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
INPUTS, TEXTURES=HERE/'inputs', HERE/'textures'
SEASONS=('spring','summer','autumn','winter')
random.seed(2607)
TEXTURES.mkdir(exist_ok=True)
materials={}
nodes=[]
duration=40
TAU=2*pi

def lin(v):
    x=v/255
    return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4

def color(name,hexcolor,rough=.75,metal=0):
    rgb=[lin(int(hexcolor[i:i+2],16)) for i in (0,2,4)]
    materials[name]=dict(color=rgb,roughness=rough,metallic=metal)

def textured(name,filename,rough=.85):
    materials[name]=dict(color=[1,1,1],roughness=rough,metallic=0,texture='textures/'+filename)

def prep_textures():
    ref=Image.open(INPUTS/'spring.webp').convert('RGB')
    def region(box):
        return ref.crop(tuple(round(v*k/800) for v,k in zip(box,[ref.width,ref.width,ref.width,ref.width])))
    def mirror_crop(name,box,size,saturation=1,brightness=1):
        crop=region(box)
        crop=ImageEnhance.Color(crop).enhance(saturation)
        crop=ImageEnhance.Brightness(crop).enhance(brightness)
        crop=crop.resize((size[0]//2,size[1]//2),Image.Resampling.LANCZOS)
        h=Image.new('RGB',(size[0],size[1]//2))
        h.paste(crop,(0,0));h.paste(ImageOps.mirror(crop),(crop.width,0))
        out=Image.new('RGB',size)
        out.paste(h,(0,0));out.paste(ImageOps.flip(h),(0,h.height))
        out.save(TEXTURES/(name+'.jpg'),quality=94)
        return out
    side=mirror_crop('weatherboard',(548,132,700,218),(640,360),.82,1.26)
    mirror_crop('shingles',(305,122,394,147),(512,168),.8,.96)
    mirror_crop('fieldstone',(8,252,133,287),(620,172),.75,1.13)
    water=mirror_crop('pond-resin',(12,344,102,425),(420,390),.85,1.05)
    water=ImageOps.colorize(ImageOps.grayscale(water),'#284c4a','#93b0a2')
    water.save(TEXTURES/'pond-resin.jpg',quality=94)
    grain=ImageOps.colorize(ImageOps.grayscale(side),'#39241b','#9e6950')
    grain.save(TEXTURES/'walnut.jpg',quality=94)
    for season in SEASONS:
        image=Image.open(INPUTS/f'{season}.webp').convert('RGB')
        # The tall central horizontal band retains the mill, skyline and water.
        crop=image.crop((0,round(image.height*.17),image.width,round(image.height*.82)))
        crop.save(TEXTURES/f'{season}.jpg',quality=94)
        label=Image.new('RGB',(544,76),'#352d25')
        draw=ImageDraw.Draw(label)
        face=ImageFont.load_default(size=37)
        text=season.upper()
        widths=[draw.textlength(c,font=face) for c in text]
        space=8
        x=(label.width-sum(widths)-space*(len(text)-1))/2
        for c,w in zip(text,widths):
            draw.text((x,39),c,font=face,anchor='lm',fill='#e6d7ab',stroke_width=0)
            x+=w+space
        label.save(TEXTURES/f'{season}-name.jpg',quality=94)

def node(name,parent=None,translation=None,rotation=None,mesh=None,animation=None):
    data={'name':name}
    for key,value in [('parent',parent),('translation',translation),('rotation',rotation),('mesh',mesh),('animation',animation)]:
        if value is not None:data[key]=value
    nodes.append(data)
    return name

def mesh(name,parent,mat,pts,idx,uv=None,double=False):
    payload={'material':mat,'points':[[round(a,7) for a in v] for v in pts],'indices':idx}
    if uv is not None:payload['uvs']=[[round(a,7) for a in v] for v in uv]
    if double:payload['doubleSided']=True
    return node(name,parent,mesh=payload)

def quads(name,parent,mat,faces,uvscale=(1,1)):
    pts=[];uv=[];idx=[]
    for face in faces:
        i=len(pts);pts.extend(face)
        if len(face)==4:
            uv.extend([(0,0),(uvscale[0],0),uvscale,(0,uvscale[1])])
            idx.extend([i,i+1,i+2,i,i+2,i+3])
        else:
            uv.extend([(0,0),(uvscale[0],0),(.5,uvscale[1])])
            idx.extend([i,i+1,i+2])
    return mesh(name,parent,mat,pts,idx,uv if 'texture' in materials[mat] else None)

def box(name,parent,mat,c,d,uvscale=(1,1)):
    x,y,z=c;w,h,l=(a/2 for a in d)
    p=[(x+ix*w,y+iy*h,z+iz*l) for ix,iy,iz in [(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1),(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)]]
    faces=[(0,1,2,3),(4,5,6,7),(1,4,7,2),(5,0,3,6),(3,2,7,6),(5,4,1,0)]
    return quads(name,parent,mat,[tuple(p[i] for i in face) for face in faces],uvscale)

def cyl(name,parent,mat,y0,y1,r0,r1=None,n=64,x=0,z=0):
    if r1 is None:r1=r0
    # +Z is front and points progress counterclockwise when viewed above.
    low=[(x+r0*sin(i*TAU/n),y0,z+r0*cos(i*TAU/n)) for i in range(n)]
    upper=[(x+r1*sin(i*TAU/n),y1,z+r1*cos(i*TAU/n)) for i in range(n)]
    faces=[]
    for i in range(n):
        j=(i+1)%n
        faces.extend([(low[i],low[j],upper[j],upper[i]),((x,y1,z),upper[i],upper[j]),((x,y0,z),low[j],low[i])])
    return quads(name,parent,mat,faces)

def beveled(name,parent,mat,w,d,profiles,corner=.012):
    rings=[]
    for y,inset in profiles:
        x=w/2-inset;z=d/2-inset;b=corner
        rings.append([(-x+b,y,z),(x-b,y,z),(x,y,z-b),(x,y,-z+b),(x-b,y,-z),(-x+b,y,-z),(-x,y,-z+b),(-x,y,z-b)])
    faces=[]
    for k in range(len(rings)-1):
        for i in range(8):
            j=(i+1)%8;faces.append((rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i]))
    for i in range(8):
        j=(i+1)%8
        faces.extend([((0,profiles[-1][0],0),rings[-1][i],rings[-1][j]),((0,profiles[0][0],0),rings[0][j],rings[0][i])])
    return quads(name,parent,mat,faces)

def frontplate(name,parent,mat,w,h,y,z):
    return quads(name,parent,mat,[[(-w/2,y-h/2,z),(w/2,y-h/2,z),(w/2,y+h/2,z),(-w/2,y+h/2,z)]])

def spinning(axis,angles,times=None):
    return {'axis':axis,'times':times if times is not None else [i*duration/(len(angles)-1) for i in range(len(angles))],'angles':angles}

def carve_relief(season,parent):
    full=Image.open(INPUTS/(season+'-depth.webp')).convert('L')
    depth=full.crop((0,round(full.height*.17),full.width,round(full.height*.82)))
    nx,ny=72,20
    data=depth.resize((nx+1,ny+1),Image.Resampling.BILINEAR)
    points=[];uv=[];indices=[]
    for y in range(ny+1):
        v=y/ny
        for x in range(nx+1):
            u=x/nx
            # The height field sits just behind the front brass bezel.
            d=data.getpixel((x,ny-y))/255
            points.append(((u-.5)*.168,.0495+(v-.5)*.0461,.11025+.0027*d))
            uv.append((u,v))
    for y in range(ny):
        for x in range(nx):
            a=y*(nx+1)+x; b=a+1;c=b+nx+1;d=a+nx+1
            indices.extend((a,b,c,a,c,d))
    mesh(season.title()+'Relief',parent,season,points,indices,uv)

def roof(name,parent,cx,cz,w,d,walltop,rise):
    # Local roof ridge runs along Z, broad end gable faces +Z.
    e=.0025; half=w/2+e;lo=walltop;hi=walltop+rise;z0=cz+d/2+e;z1=cz-d/2-e
    front=[(cx-w/2,lo,cz+d/2),(cx+w/2,lo,cz+d/2),(cx,hi,cz+d/2)]
    back=[(cx+w/2,lo,cz-d/2),(cx-w/2,lo,cz-d/2),(cx,hi,cz-d/2)]
    quads(name+'Gables',parent,'Timber',[front,back])
    # Duplicate reversed underside as a physical eave with wooden colored fascia.
    quads(name+'Shingles',parent,'Shingle',[
       [(cx-half,lo,z0),(cx,hi,z0),(cx,hi,z1),(cx-half,lo,z1)],
       [(cx,hi,z0),(cx+half,lo,z0),(cx+half,lo,z1),(cx,hi,z1)]],(2,1.7))
    for j,z in enumerate((z0,z1)):
        for k,sign in enumerate((-1,1)):
            a=(cx+sign*half,lo,z);b=(cx,hi,z)
            beam(name+f'Fascia{j}{k}',parent,'RoofRim',a,b,.0016)
    beam(name+'Ridge',parent,'RoofRim',(cx,hi,z0),(cx,hi,z1),.0015)

def beam(name,parent,mat,start,end,r):
    import math
    a=start;b=end
    direction=[b[i]-a[i] for i in range(3)]
    length=math.sqrt(sum(v*v for v in direction))
    n=[v/length for v in direction]
    temp=(1,0,0) if abs(n[0])<.9 else (0,0,1)
    def cross(u,v): return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
    u=cross(n,temp);scale=math.sqrt(sum(v*v for v in u));u=[v/scale for v in u];v=cross(n,u)
    ends=[[[c[j]+r*(u[j]*cos(i*TAU/6)+v[j]*sin(i*TAU/6)) for j in range(3)] for i in range(6)] for c in (a,b)]
    faces=[]
    for i in range(6):
        j=(i+1)%6
        faces.extend([(ends[0][i],ends[0][j],ends[1][j],ends[1][i]),(a,ends[0][j],ends[0][i]),(b,ends[1][i],ends[1][j])])
    return quads(name,parent,mat,faces)

def ring_z(name,parent,mat,r0,r1,z,thickness,n=36):
    rings=[[(r*sin(i*TAU/n),r*cos(i*TAU/n),h) for i in range(n)] for r,h in [(r0,z),(r1,z),(r1,z+thickness),(r0,z+thickness)]]
    faces=[]
    for i in range(n):
        j=(i+1)%n
        for k in range(4):
            l=(k+1)%4
            faces.append((rings[k][j],rings[k][i],rings[l][i],rings[l][j]))
    return quads(name,parent,mat,faces)

def tree(name,parent,x,z,y,scale,palette):
    # Contiguous faceted canopy clumps and branching trunks mimic a carved museum model.
    matleaf='PaperBirch' if palette==3 else 'Bark'
    treeparent=node(name,parent,[x,y,z])
    crown=[(-.009,.029,.004),(.008,.031,.004),(-.003,.041,-.003),(.003,.048,.001),(.013,.036,-.006),(-.012,.034,-.004)]
    def pt(p):return tuple(v*scale for v in p)
    beam('Trunk'+name,treeparent,matleaf,pt((0,0,0)),pt((.001,.045,0)),.0017*scale)
    for i,(xv,yv,zv) in enumerate(crown):
        end=pt((xv,yv,zv))
        mid=pt((xv*.46,yv*.8,zv*.46))
        beam('Branch'+name+str(i),treeparent,matleaf,pt((0,.016+i*.0014,0)),mid,.0009*scale)
        beam('Twig'+name+str(i),treeparent,matleaf,mid,end,.00059*scale)
        if palette==3:
            beam('Fine'+name+str(i),treeparent,matleaf,mid,pt((xv*1.15,yv+.006,zv+.003)),.00037*scale)
        else:
            leafy('Crown'+name+str(i),treeparent,f'Foliage{palette}{i%3}',end,pt((.0105,.014,.011)),i)

def leafy(name,parent,material,c,r,seed):
    points=[];idx=[]
    n=9; rows=5
    rng=random.Random(68+seed)
    for row in range(rows+1):
        t=row*pi/rows
        for i in range(n):
            a=(i+(.5 if row%2 else 0))*TAU/n; noise=.86+.22*rng.random()
            if row==0 or row==rows:noise=1
            points.append((c[0]+r[0]*sin(t)*cos(a)*noise,c[1]+r[1]*cos(t)*noise,c[2]+r[2]*sin(t)*sin(a)*noise))
    for row in range(rows):
        for i in range(n):
            a=row*n+i;b=row*n+(i+1)%n;c1=b+n;d=a+n
            if row<rows-1:idx.extend([a,c1,d])
            if row>0:idx.extend([a,b,c1])
    return mesh(name,parent,material,points,idx)

def make_scene():
    for name,hexcolor,rough,metal in [
        ('Bronze','a78748',.32,.68),('GoldEdge','d5bd85',.31,.63),
        ('Soot','2e3230',.50,.24),('RoofRim','4a4740',.79,0),('Beams','514535',.81,0),
        ('Sash','a49d89',.63,0),('Glass','344a4a',.26,.27),('Mullions','756b59',.65,0),
        ('Bark','645644',.88,0),('PaperBirch','a19d8e',.90,0),
        ('Water','416e69',.23,.30),('Ripple','71948a',.32,.19),
        ('Land','61725a',.89,0),('Grass','718761',.89,0),('Shore','82816b',.92,0),
        ('SpringFlower','d4bd78',.73,0),('Weathered','73624d',.75,0),('Brick','8c6a56',.85,0),
        ('Snow','dfdfd1',.83,0),('Stone','777568',.89,0)]:
        color(name,hexcolor,rough,metal)
    for si,cols in enumerate([('90a165','9baa6c','aab581'),('70895f','829764','566d53'),('bd7841','aa6036','c79754')]):
        for k,v in enumerate(cols):color(f'Foliage{si}{k}',v,.89)
    for name,file in [('Timber','weatherboard.jpg'),('Shingle','shingles.jpg'),('Masonry','fieldstone.jpg'),('Walnut','walnut.jpg')]:
        textured(name,file)
    textured('PondResin','pond-resin.jpg',.61)
    materials['PondResin']['metallic']=.035
    for season in SEASONS:
        textured(season,season+'.jpg');textured(season+'Name',season+'-name.jpg')
    base=node('SeasonMill')
    cyl('FootShadow',base,'Soot',0,.003,.150,.154,96)
    cyl('FootBronze',base,'Bronze',.003,.005,.155,.158,96)
    cyl('FootWalnut',base,'Walnut',.005,.012,.158,.158,96)
    cyl('FootGoldLine',base,'GoldEdge',.012,.0135,.158,.158,96)
    cyl('TurntableBevel',base,'Walnut',.0135,.018,.158,.153,96)
    cyl('Bearing',base,'Soot',.018,.020,.119,.119,72)
    times=[0];angles=[0]
    # Long view of each face, followed by an eased mechanical quarter turn.
    for quadrant in range(4):
        for local in (5,5.5,6,6.5,7,7.5,8,8.5,9,9.5,10):
            t=max(0,min(1,(local-5)/5));f=t*t*(3-2*t)
            times.append(10*quadrant+local);angles.append(-90*(quadrant+f))
    rotor=node('SeasonTurntable',base,animation=spinning('Y',angles,times))
    beveled('BronzeSkirt',rotor,'Bronze',.220,.220,[(.019,.002),(.021,0),(.023,0)])
    beveled('WalnutCabinet',rotor,'Walnut',.218,.218,[(.022,.002),(.024,0),(.078,0),(.081,.002)])
    beveled('TopInlay',rotor,'GoldEdge',.219,.219,[(.0778,.001),(.079,0),(.0805,0)])
    beveled('CabinetCrown',rotor,'Walnut',.223,.223,[(.0804,.002),(.0825,0),(.0865,.002)])
    for i,s in enumerate(SEASONS):
        face=node(s.title()+'Window',rotor,rotation=[0,90*i,0])
        box(s.title()+'Bezel',face,'Bronze',(0,.0495,.10945),(.172,.049,.0012))
        carve_relief(s,face)
        for sign in [-1,1]:
            box(s.title()+('L' if sign<0 else 'R')+'Bead',face,'GoldEdge',(sign*.0842,.0495,.11324),(.0011,.0474,.00075))
            box(s.title()+('Bottom' if sign<0 else 'Top')+'Bead',face,'GoldEdge',(0,.0495+sign*.0233,.11324),(.1696,.001,.00075))
        box(s.title()+'NamePlate',face,'Bronze',(0,.02385,.1102),(.047,.0076,.0023))
        frontplate(s.title()+'Lettering',face,s+'Name',.045,.00628,.02385,.11138)
    beveled('PondSurface',rotor,'Water',.214,.214,[(.085,.001),(.087,0)],.010)
    # A continuous UV projection across the carved resin keeps the painted wave texture aligned.
    n=60
    pts=[];uv=[];ids=[]
    for iz in range(n+1):
        v=iz/n
        z=(v-.5)*.212
        for ix in range(n+1):
            u=ix/n;x=(u-.5)*.212
            y=.08733+.00010*sin(z*850+x*85+sin(x*100)*.9)+.000045*sin(z*470-x*177)
            pts.append([x,y,z]);uv.append([u*1.8,(1-v)*2.1])
    for iz in range(n):
        for ix in range(n):
            a=iz*(n+1)+ix;b=a+1;c=b+n+1;d=a+n+1
            if max(abs(pts[i][0])+abs(pts[i][2]) for i in [a,b,c,d])>.199:continue
            ids.extend([a,c,b,a,d,c])
    mesh('ReservoirWater',rotor,'PondResin',pts,ids,uv)
    # Earth rises behind the mill and tapers into two islands at the millrace.
    nx,nz=40,42
    pts=[];ids=[]
    for iz in range(nz+1):
        z=-.102+.204*iz/nz
        for ix in range(nx+1):
            x=-.102+.204*ix/nx
            mainz=-.014+.016*sin(x*35)+.004*cos(x*215)
            back=.087+max(0,min(.0125,(mainz-z)*.31))
            islet=.0878+.0035*exp(-((z-.053+x*.29)/.0085)**2)*exp(-((x+.01)/.071)**4)
            mound=back if z<mainz else islet if islet>.088 else .085
            if mound>.088:mound+=.0007*sin(x*200)*cos(z*160)
            pts.append([x,mound,z])
    for iz in range(nz):
        for ix in range(nx):
            a=iz*(nx+1)+ix;b=a+1;c=b+nx+1;d=a+nx+1
            x,z=pts[a][0],pts[a][2]
            if abs(x)+abs(z)>.198 or max(pts[i][1] for i in [a,b,c,d])<.0876:continue
            ids.extend([a,c,b,a,d,c])
    mesh('MillGround',rotor,'Grass',pts,ids)
    # A narrow green resin bank at front breaks the pond reflection as in the print.
    for i in range(24):
        x=-.077+i*.0064
        z=.053-x*.29+.0017*sin(i*2)
        r=.0008+.0009*(.5+.5*sin(i*7))
        leafy('BankRush'+str(i),rotor,'Grass',(x,.091,z),(r*1.1,r*1.4,r),i)
        if i%3==0:leafy('Blossom'+str(i),rotor,'SpringFlower',(x,.093,z),(r*.48,r*.47,r*.48),i)
    # Short, low glints in the resin show a water surface between the masonry piers.
    for i in range(23):
        x=random.uniform(-.084,.084);z=random.uniform(.021,.097)
        if abs(z-.053+x*.29)<.010 or (.002<x<.070 and z<.05):continue
        beam('Waterline'+str(i),rotor,'Ripple',(x,.08715,z),(x+random.uniform(.003,.010),.08715,z-.0006),.00017)
    # Gabled mill with side wing. Materials are cut from the original Moeckel Pond artwork.
    main=node('GableMill',rotor,[.035,0,-.008])
    wing=node('MillWing',rotor,[-.031,0,-.018],[0,90,0])
    def building(parent,width,length,base_y,top,rise):
        spanw=width/2;spanl=length/2
        for ix in [-1,1]:
            for iz in [-1,0,1]:
                x=ix*(spanw-.006);z=iz*(spanl-.006)
                box('Pier'+parent+str(ix+1)+str(iz+1),parent,'Masonry',(x,(base_y+.0868)/2,z),(.0115,base_y-.0868,.012),(1.2,1.2))
        box(parent+'Floor',parent,'Beams',(0,base_y+.0007,0),(width+.0013,.0028,length+.0013))
        box(parent+'Walls',parent,'Timber',(0,(base_y+top)/2,0),(width,top-base_y,length),(1.50,1.35))
        roof(parent+'Roof',parent,0,0,width,length,top,rise)
        for sign in [-1,1]:
            box(parent+('Left' if sign<0 else 'Right')+'Post',parent,'Sash',(sign*(spanw-.0013),(base_y+top)/2,spanl+.0005),(.0019,top-base_y,.0012))
        # Windows form a row on both long walls under the eaves.
        for side in [-1,1]:
            for ix,z in enumerate([-.29*length,0,.29*length]):
                for j,y in enumerate([base_y+.36*(top-base_y),base_y+.80*(top-base_y)]):
                    window=node(parent+f'Window{side+1}{ix}{j}',parent,[side*(spanw+.0004),y,z],[0,side*90,0])
                    box(window+'Trim',window,'Sash',(0,0,0),(.0067,.0085,.0008))
                    box(window+'Pane',window,'Glass',(0,0,.00046),(.0054,.00695,.00019))
                    box(window+'Cross',window,'Mullions',(0,0,.00064),(.0054,.00045,.00016))
        if parent==main:
            box('MillBackDoor',parent,'Beams',(0,base_y+.006,-spanl-.00025),(.009,.014,.0009))
        else:
            box('WingChimney',parent,'Brick',(.004,top+rise,.009),(.0057,.009,.0061))
            box('ChimneyCrown',parent,'RoofRim',(.004,top+rise+.0044,.009),(.0065,.0015,.0069))
    building(main,.068,.086,.109,.1505,.024)
    building(wing,.043,.079,.106,.143,.0145)
    # A working wooden overshot wheel on the front of the mill wing.
    wheel=node('WaterWheel',rotor,[-.034,.106,.014],animation=spinning('Z',[-i*45 for i in range(33)]))
    for i,z in enumerate([.0006,.0078]):
        ring_z('IronHoop'+str(i),wheel,'Soot',.0152,.0165,z,.0012)
        ring_z('WheelRail'+str(i),wheel,'Weathered',.0128,.0155,z+.0004,.0014)
    for i in range(14):
        shaft=node('WheelBlade'+str(i),wheel,rotation=[0,0,i*360/14])
        box('Paddle'+str(i),shaft,'Weathered',(0,.0151,.0046),(.0033,.0021,.0097))
        if i%2==0:
            box('Spoke'+str(i),shaft,'Beams',(0,.007,.0081),(.00115,.0126,.001))
    hub=node('WheelAxle',wheel,rotation=[90,0,0])
    cyl('AxleDisk',hub,'Bronze',-.001,.0098,.0029,n=16)
    # Timber sluice and bridge.
    box('Sluice',rotor,'Beams',(-.031,.124,.006),(.041,.0026,.006))
    for i in range(4):
        x=-.082+i*.0084
        box('WalkPost'+str(i),rotor,'Beams',(x,.1077,.009),(.0018,.020,.0018))
    box('WalkRail',rotor,'Weathered',(-.0695,.1163,.009),(.029,.00165,.0018))
    box('WalkDeck',rotor,'Weathered',(-.0695,.109,.005),(.030,.0018,.009))
    # Spring, summer, autumn and bare winter branches frame the four orientations.
    for args in [
        ('Willow',-.083,-.020,.096,.90,0),('Alder',-.078,-.049,.098,.87,0),
        ('Maple',.082,-.034,.097,.97,1),('Beech',.069,-.076,.098,.86,1),
        ('Copper',.027,-.081,.098,.98,2),('Oak',-.025,-.075,.098,.77,2),
        ('Birch',-.067,-.071,.099,1.09,3),('BirchSmall',-.086,-.069,.099,.89,3)]:
        tree(args[0],rotor,*args[1:])
    for i in range(13):
        x=random.uniform(-.08,.078);z=-.066+random.uniform(-.014,.006)
        leafy('Stone'+str(i),rotor,'Stone',(x,.099,z),(.0039,.0025,.0046),i)

def r3(a):return '('+', '.join(f'{x:.7g}' for x in a)+')'
def arr(a):return '['+', '.join(str(x) for x in a)+']'
def unshade():
    text=[]
    for name,m in materials.items():
        p='/SeasonMill/Materials/'+name
        texture=m.get('texture')
        terminal='            color3f inputs:diffuseColor.connect = <'+p+'/Albedo.outputs:rgb>' if texture else '            color3f inputs:diffuseColor = '+r3(m['color'])
        text.append(f'''        def Material "{name}" {{
            token outputs:surface.connect = <{p}/Finish.outputs:surface>
            def Shader "Finish" {{
                uniform token info:id = "UsdPreviewSurface"
                {terminal.strip()}
                float inputs:roughness = {m['roughness']}
                float inputs:metallic = {m['metallic']}
                token outputs:surface
            }}''')
        if texture:
            text.append(f'''            def Shader "Coordinates" {{
                uniform token info:id = "UsdPrimvarReader_float2"
                string inputs:varname = "st"
                float2 outputs:result
            }}
            def Shader "Albedo" {{
                uniform token info:id = "UsdUVTexture"
                asset inputs:file = @{texture}@
                token inputs:sourceColorSpace = "sRGB"
                token inputs:wrapS = "repeat"
                token inputs:wrapT = "repeat"
                float2 inputs:st.connect = <{p}/Coordinates.outputs:result>
                float3 outputs:rgb
            }}''')
        text.append('        }')
    return '    def Scope "Materials" {\n'+'\n'.join(text)+'\n    }'

def usd():
    kids={}
    for n in nodes:kids.setdefault(n.get('parent'),[]).append(n)
    def emit(n,indent):
        name=n['name'];m=n.get('mesh');kind='Mesh' if m else 'Xform'
        meta=' (prepend apiSchemas = ["MaterialBindingAPI"])' if m else ''
        if name=='SeasonMill':meta=' (prepend apiSchemas = ["Preliminary_AnchoringAPI"])'
        s=[indent+f'def {kind} "{name}"'+meta+' {']
        d=indent+'    ';ops=[]
        if name=='SeasonMill':s.extend([d+'uniform token preliminary:anchoring:type = "plane"',d+'uniform token preliminary:planeAnchoring:alignment = "horizontal"',unshade()])
        if n.get('translation'):
            s.append(d+'double3 xformOp:translate = '+r3(n['translation']));ops.append('xformOp:translate')
        if n.get('rotation'):
            s.append(d+'float3 xformOp:rotateXYZ = '+r3(n['rotation']));ops.append('xformOp:rotateXYZ')
        if n.get('animation'):
            an=n['animation'];axis=an['axis'];samples=', '.join(f'{round(t*24)}: {v:.9g}' for t,v in zip(an['times'],an['angles']))
            s.append(d+f'float xformOp:rotate{axis}.timeSamples = {{'+samples+'}');ops.append('xformOp:rotate'+axis)
        if ops:s.append(d+'uniform token[] xformOpOrder = '+json.dumps(ops))
        if m:
            indices=m['indices'];s.extend([
                d+'point3f[] points = '+arr(r3(p) for p in m['points']),
                d+'int[] faceVertexCounts = '+arr([3]*(len(indices)//3)),
                d+'int[] faceVertexIndices = '+arr(indices),
                d+'uniform token subdivisionScheme = "none"',
                d+'rel material:binding = </SeasonMill/Materials/'+m['material']+'>'])
            if m.get('doubleSided'):s.append(d+'uniform bool doubleSided = 1')
            if m.get('uvs'):s.append(d+'texCoord2f[] primvars:st = '+arr(r3(p) for p in m['uvs'])+' (interpolation = "vertex")')
        for child in kids.get(name,[]):s.append(emit(child,d))
        s.append(indent+'}')
        return '\n'.join(s)
    return f'''#usda 1.0
(
    defaultPrim = "SeasonMill"
    metersPerUnit = 1
    upAxis = "Y"
    startTimeCode = 0
    endTimeCode = {duration*24}
    timeCodesPerSecond = 24
    framesPerSecond = 24
    autoPlay = true
    playbackMode = "loop"
)
'''+emit(nodes[0],'')+'\n'


def batch_static_geometry():
    # Only the wheel and turntable move. Group their fixed details by material to
    # retain the same rendering with a small number of draws on phone GPUs.
    source={n['name']:n for n in nodes}
    keep={n['name'] for n in nodes if not n.get('parent') or n.get('animation')}
    grouped={}
    def transform(point,n):
        x,y,z=point
        for axis,degrees in enumerate(n.get('rotation',(0,0,0))):
            a=degrees*pi/180;c=cos(a);s=sin(a)
            if axis==0:y,z=y*c-z*s,y*s+z*c
            elif axis==1:x,z=x*c+z*s,-x*s+z*c
            else:x,y=x*c-y*s,x*s+y*c
        dx,dy,dz=n.get('translation',(0,0,0))
        return (x+dx,y+dy,z+dz)
    for n in nodes:
        m=n.get('mesh')
        if not m:continue
        chain=[];q=n
        while q['name'] not in keep:
            if q.get('rotation') or q.get('translation'):chain.append(q)
            q=source[q['parent']]
        parent=q['name'];mat=m['material']
        k=(parent,mat,bool(m.get('doubleSided')))
        g=grouped.setdefault(k,{'material':mat,'points':[],'indices':[]})
        start=len(g['points'])
        for p in m['points']:
            for item in chain:p=transform(p,item)
            g['points'].append([round(v,7) for v in p])
        g['indices'].extend(i+start for i in m['indices'])
        if m.get('uvs'):g.setdefault('uvs',[]).extend(m['uvs'])
        if m.get('doubleSided'):g['doubleSided']=True
    nodes[:]=[n for n in nodes if n['name'] in keep]
    for (parent,mat,_),g in grouped.items():
        suffix='Relief' if mat in SEASONS else 'Geometry'
        node(parent+mat.title()+suffix,parent,mesh=g)

def build():
    prep_textures();make_scene();batch_static_geometry()
    assert len({n['name'] for n in nodes})==len(nodes)
    manifest={'materials':materials,'nodes':nodes,'duration':duration}
    (HERE/'scene.json').write_text(json.dumps(manifest,separators=(',',':')))
    (HERE/'SeasonMill.usda').write_text(usd())
    subprocess.run(['usdcat','SeasonMill.usda','-o','SeasonMill.usdc'],cwd=HERE,check=True)
    usdfile=HERE/'moeckel-pond-miniature.usdz'
    subprocess.run(['usdzip',usdfile.name,'SeasonMill.usdc',*[str(p.relative_to(HERE)) for p in sorted(TEXTURES.glob('*.jpg'))]],cwd=HERE,check=True)
    subprocess.run(['usdchecker','--arkit','--strict',str(usdfile)],check=True)
    print('nodes:',len(nodes),'triangles:',sum(len(n['mesh']['indices'])//3 for n in nodes if n.get('mesh')),'USDZ bytes:',usdfile.stat().st_size)
if __name__=='__main__':build()
