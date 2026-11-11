import json,subprocess
from pathlib import Path
def r3(a):return '('+', '.join(f'{x:.7g}' for x in a)+')'
def arr(a):return '['+', '.join(str(x) for x in a)+']'
def unshade():
    text=[]
    for name,m in materials.items():
        p='/MoeckelMill/Materials/'+name
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
        if name=='MoeckelMill':meta=' (prepend apiSchemas = ["Preliminary_AnchoringAPI"])'
        s=[indent+f'def {kind} "{name}"'+meta+' {']
        d=indent+'    ';ops=[]
        if name=='MoeckelMill':s.extend([d+'uniform token preliminary:anchoring:type = "plane"',d+'uniform token preliminary:planeAnchoring:alignment = "horizontal"',unshade()])
        if n.get('translation'):
            s.append(d+'double3 xformOp:translate = '+r3(n['translation']));ops.append('xformOp:translate')
        if n.get('rotation'):
            s.append(d+'float3 xformOp:rotateXYZ = '+r3(n['rotation']));ops.append('xformOp:rotateXYZ')
        if n.get('animation'):
            an=n['animation'];samples=', '.join(f'{round(t*24)}: {r3(v)}' for t,v in zip(an['times'],an['values']))
            s.append(d+'float3 xformOp:translate.timeSamples = {'+samples+'}');ops.append('xformOp:translate')
        if ops:s.append(d+'uniform token[] xformOpOrder = '+json.dumps(ops))
        if m:
            indices=m['indices'];s.extend([
                d+'point3f[] points = '+arr(r3(p) for p in m['points']),
                d+'int[] faceVertexCounts = '+arr([3]*(len(indices)//3)),
                d+'int[] faceVertexIndices = '+arr(indices),
                d+'uniform token subdivisionScheme = "none"',
                d+'rel material:binding = </MoeckelMill/Materials/'+m['material']+'>'])
            if m.get('doubleSided'):s.append(d+'uniform bool doubleSided = 1')
            if m.get('normals'):s.append(d+'normal3f[] normals = '+arr(r3(p) for p in m['normals'])+' (interpolation = "vertex")')
            if m.get('uvs'):s.append(d+'texCoord2f[] primvars:st = '+arr(r3(p) for p in m['uvs'])+' (interpolation = "vertex")')
        for child in kids.get(name,[]):s.append(emit(child,d))
        s.append(indent+'}')
        return '\n'.join(s)
    return f'''#usda 1.0
(
    defaultPrim = "MoeckelMill"
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



def write_usdz(scene, target):
    global materials,nodes,duration
    materials=scene['materials'];nodes=scene['nodes'];duration=scene['duration']
    (target/'MoeckelMill.usda').write_text(usd())
    subprocess.run(['usdcat','MoeckelMill.usda','-o','MoeckelMill.usdc'],cwd=target,check=True)
    files=sorted({m['texture'] for m in materials.values() if m.get('texture')})
    subprocess.run(['usdzip','moeckel-pond-miniature.usdz','MoeckelMill.usdc',*files],cwd=target,check=True)
    subprocess.run(['usdchecker','--arkit','--strict','moeckel-pond-miniature.usdz'],cwd=target,check=True)
