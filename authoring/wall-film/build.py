#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build a native, whole-frame edition of the original Moeckel Pond wall film.

Run with Python 3, NumPy, Pillow, FFmpeg and OpenUSD command line utilities.
One 16:9 quad always carries a complete decoded source image. Selection is
global across the image. Atlas cells are storage for complete frames.
"""
import argparse
import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

WIDTH, HEIGHT = 512, 288
FPS, SOURCE_FRAMES = 24, 995
MAX_HOLD = 6
RMS_DELTA, LOCAL_DELTA = 3.5, 28.0
COLUMNS, ROWS = 6, 6
PER_SHEET = COLUMNS * ROWS
PAD = 3
STRIDE_X, STRIDE_Y = WIDTH + 2 * PAD, HEIGHT + 2 * PAD
PANEL_WIDTH, PANEL_HEIGHT = 0.584, 0.3285
ROOT = '/MoeckelWallFilm'

def array(values):
    return '[' + ', '.join(str(v) for v in values) + ']'

def vector(values):
    return '(' + ', '.join(format(v, '.9g') for v in values) + ')'

def ffmpeg():
    path = shutil.which('ffmpeg')
    if path:
        return path
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def require_command(*command, cwd=None):
    subprocess.run(command, cwd=cwd, check=True)

def select_frames(source):
    command = [ffmpeg(), '-nostdin', '-v', 'error', '-i', str(source),
               '-map', '0:v:0', '-an', '-vf', f'scale={WIDTH}:{HEIGHT}:flags=lanczos',
               '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']
    stream = subprocess.Popen(command, stdout=subprocess.PIPE)
    frames, starts = [], []
    largest_held_rms = 0.0
    number = 0
    while True:
        data = stream.stdout.read(WIDTH * HEIGHT * 3)
        if not data:
            break
        pixels = np.frombuffer(data, dtype=np.uint8).reshape(HEIGHT, WIDTH, 3)
        current = pixels.astype(np.float32)
        use = not starts or number - starts[-1] >= MAX_HOLD
        if not use:
            squared = ((current - previous) ** 2).mean(axis=2)
            mean = squared.mean()
            # The local test catches the heron against a mostly static scene.
            # Both tests have one output: keep or replace the complete image.
            local_peak = squared.reshape(18, 16, 32, 16).mean(axis=(1, 3)).max()
            use = mean > RMS_DELTA ** 2 or local_peak > LOCAL_DELTA ** 2
            if not use:
                largest_held_rms = max(largest_held_rms, float(math.sqrt(mean)))
        if use:
            starts.append(number)
            frames.append(Image.fromarray(pixels.copy()))
            previous = current
        number += 1
    if stream.wait() or number != SOURCE_FRAMES:
        raise RuntimeError(f'Expected a {SOURCE_FRAMES}-frame film, decoded {number}')
    return starts, frames, largest_held_rms

def pack_sheet(frames, destination, quality):
    width = COLUMNS * STRIDE_X
    height = ROWS * STRIDE_Y
    sheet = np.zeros((height, width, 3), np.uint8)
    for i, image in enumerate(frames):
        x = i % COLUMNS * STRIDE_X
        y = i // COLUMNS * STRIDE_Y
        # Extend true perimeter pixels. No sampled UV reaches a neighbor frame.
        bordered = np.pad(np.asarray(image), ((PAD, PAD), (PAD, PAD), (0, 0)), mode='edge')
        sheet[y:y + STRIDE_Y, x:x + STRIDE_X] = bordered
    Image.fromarray(sheet).save(destination, quality=quality, optimize=True, subsampling=2)
    return width, height

def rectangle(width, height, depth):
    # Apple's vertical plane anchor uses +Y outward, -Z toward the top of the picture.
    return [(-width/2, depth, height/2), (width/2, depth, height/2),
            (width/2, depth, -height/2), (-width/2, depth, -height/2)]

def mesh_fields(points, indices, material, uvs=None):
    lines = [
        'point3f[] points = ' + array(vector(p) for p in points),
        'int[] faceVertexCounts = ' + array([3] * (len(indices) // 3)),
        'int[] faceVertexIndices = ' + array(indices),
        'uniform token subdivisionScheme = "none"',
        f'rel material:binding = <{ROOT}/Materials/{material}>'
    ]
    if uvs is not None:
        lines.append('texCoord2f[] primvars:st = ' + array(vector(p) for p in uvs) + ' (interpolation = "vertex")')
    return '\n'.join(lines)

def mesh(name, points, indices, material, uv=None):
    return f'def Mesh "{name}" (prepend apiSchemas = ["MaterialBindingAPI"]) {{\n' + mesh_fields(points, indices, material, uv) + '\n}'

def molding(name, rings, material, backing=False):
    points = [v for width, height, depth in rings for v in rectangle(width, height, depth)]
    indices = [0, 2, 1, 0, 3, 2] if backing else []
    for k in range(len(rings) - 1):
        for i in range(4):
            j = (i + 1) % 4
            a, b = 4*k+i, 4*k+j
            indices.extend((a, b, b+4, a, b+4, a+4))
    return mesh(name, points, indices, material)

def material(name, rgb, roughness, metal=0, texture=None):
    path = f'{ROOT}/Materials/{name}'
    emission = ''
    reader = ''
    if texture:
        emission = f'''color3f inputs:emissiveColor.connect = <{path}/Image.outputs:rgb>
            float inputs:ior = 1
            int inputs:useSpecularWorkflow = 1
            color3f inputs:specularColor = (0, 0, 0)'''
        reader = f'''def Shader "UV" {{
            uniform token info:id = "UsdPrimvarReader_float2"
            string inputs:varname = "st"
            float2 outputs:result
        }}
        def Shader "Image" {{
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @{texture}@
            token inputs:sourceColorSpace = "sRGB"
            float2 inputs:st.connect = <{path}/UV.outputs:result>
            token inputs:wrapS = "clamp"
            token inputs:wrapT = "clamp"
            float3 outputs:rgb
        }}'''
    return f'''def Material "{name}" {{
        token outputs:surface.connect = <{path}/Surface.outputs:surface>
        def Shader "Surface" {{
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = {vector(rgb)}
            float inputs:roughness = {roughness}
            float inputs:metallic = {metal}
            {emission}
            token outputs:surface
        }}
        {reader}
    }}'''

def film_material(sheet_count):
    """Use one flat mesh and one uniform timeline value for all its fragments.

    The film plane is exactly flat on local Y=0. Animating only its Y scale
    carries the frame number without moving any vertex. A ratio of object-to-
    world axis lengths removes uniform placement scale and rotation.
    """
    path = ROOT + '/Materials/Film'
    graph = []
    def link(key, kind, node):
        return f'{kind} inputs:{key}.connect = <{path}/{node}.outputs:out>'
    def literal(key, kind, data):
        return f'{kind} inputs:{key} = {data}'
    def shader(name, shader_id, inputs, output='float'):
        fields = '\n'.join('            '+v for v in inputs)
        graph.append(f'''        def Shader "{name}" {{
            uniform token info:id = "{shader_id}"
{fields}
            {output} outputs:out
        }}''')
        return name
    def scalar_input(key, variable):
        if isinstance(variable, str):
            return link(key, 'float', variable)
        return literal(key, 'float', f'{variable:.12g}')
    def binary(name, op, a, b):
        return shader(name, 'ND_'+op+'_float', [scalar_input('in1', a), scalar_input('in2', b)])
    def floor(name, source):
        return shader(name, 'ND_floor_float', [scalar_input('in',source)])
    def clamp(name, source, low, high):
        return shader(name, 'ND_clamp_float', [scalar_input('in',source),scalar_input('low',low),scalar_input('high',high)])
    for axis, direction in [('X','(1, 0, 0)'),('Y','(0, 1, 0)')]:
        shader('Axis'+axis,'ND_transformvector_vector3',[
            literal('in','float3',direction),literal('fromspace','string','"object"'),
            literal('tospace','string','"world"')], 'float3')
        shader('Length'+axis,'ND_magnitude_vector3',[link('in','float3','Axis'+axis)])
    binary('FrameSignal','divide','LengthY','LengthX')
    binary('FrameCentered','subtract','FrameSignal',0.5)
    floor('ImageIndex','FrameCentered')
    binary('SheetFraction','divide','ImageIndex',PER_SHEET)
    floor('SheetIndex','SheetFraction')
    binary('RowFraction','divide','ImageIndex',COLUMNS)
    floor('AllRows','RowFraction')
    binary('FirstInRow','multiply','AllRows',COLUMNS)
    binary('Column','subtract','ImageIndex','FirstInRow')
    binary('FirstRowInSheet','multiply','SheetIndex',ROWS)
    binary('Row','subtract','AllRows','FirstRowInSheet')
    shader('PrintCoordinates','ND_texcoord_vector2',[], 'float2')
    for key,index in [('U',0),('V',1)]:
        shader(key,'ND_extract_vector2',[link('in','float2','PrintCoordinates'),literal('index','int',index)])
    atlas_width = COLUMNS*STRIDE_X
    atlas_height = ROWS*STRIDE_Y
    binary('ColumnOffset','multiply','Column',1/COLUMNS)
    binary('InFrameU','multiply','U',WIDTH/atlas_width)
    binary('LeftBorder','add','ColumnOffset',PAD/atlas_width)
    binary('AtlasU','add','LeftBorder','InFrameU')
    # MaterialX image sampling follows the USD st convention on RealityKit.
    binary('RowOffset','multiply','Row',-1/ROWS)
    binary('InFrameV','multiply','V',HEIGHT/atlas_height)
    binary('BottomBorder','add','RowOffset',1-(HEIGHT+PAD)/atlas_height)
    binary('AtlasV','add','BottomBorder','InFrameV')
    shader('AtlasCoordinates','ND_combine2_vector2',[scalar_input('in1','AtlasU'),scalar_input('in2','AtlasV')],'float2')
    selected = None
    for number in range(sheet_count):
        image = shader(f'Reel{number:02d}','ND_image_color3',[
            literal('file','asset',f'@images/reel-{number:02d}.jpg@'),
            link('texcoord','float2','AtlasCoordinates'),
            literal('uaddressmode','string','"clamp"'),literal('vaddressmode','string','"clamp"')],'color3f')
        if selected is None:
            selected = image
            continue
        test=binary(f'SheetOffset{number}','subtract','SheetIndex',number-1)
        weight=clamp(f'UseSheet{number}',test,0,1)
        selected=shader(f'ChooseSheet{number}','ND_mix_color3',[
            link('bg','color3f',selected),link('fg','color3f',image),scalar_input('mix',weight)],'color3f')
    shader('Screen','ND_realitykit_unlit_surfaceshader',[
        literal('applyPostProcessToneMap','bool',0),link('color','color3f',selected),literal('opacity','float',1)],'token')
    universal = material('Film', (0,0,0), 1, texture='images/opening.jpg').rstrip()
    return universal[:-1] + f'\n        token outputs:mtlx:surface.connect = <{path}/Screen.outputs:out>\n' + '\n'.join(graph) + '\n}'

def film_plane(starts):
    # The two in-plane axes stay at scale one. A uniform scale on the full
    # model (e.g. pinching in Quick Look) therefore cancels in LengthY/LengthX.
    keys = {0: 1}
    for index,time in enumerate(starts[1:],1):
        keys[time - 0.002] = index
        keys[time] = index + 1
    keys[SOURCE_FRAMES] = len(starts)
    samples = ',\n'.join(f'            {t:.6f}: (1, {y}, 1)' for t,y in sorted(keys.items()))
    fields = mesh_fields(rectangle(PANEL_WIDTH,PANEL_HEIGHT,0),[0,1,2,0,2,3],
                         'Film',[(0,0),(1,0),(1,1),(0,1)])
    return f'''def Mesh "FilmScreen" (prepend apiSchemas = ["MaterialBindingAPI"]) {{
        double3 xformOp:translate = (0, 0.0186, 0)
        float3 xformOp:scale.timeSamples = {{
{samples}
        }}
        uniform token[] xformOpOrder = ["xformOp:translate","xformOp:scale"]
        {fields}
    }}'''

def write_stage(source, out, *, diagnostic=False):
    out.mkdir(parents=True, exist_ok=True)
    pics = out/'images'
    pics.mkdir(exist_ok=True)
    starts, frames, max_error = select_frames(source)
    if diagnostic:
        # QA copy alone uses a different full-plane flat color for each image.
        def rgb(i):
            return tuple(22+33*((i // (7**j)) % 7) for j in range(3))
        frames = [Image.new('RGB', (WIDTH, HEIGHT), rgb(i)) for i in range(len(starts))]
        Image.new('RGB',(32,32),(254,0,250)).save(pics/'opening.jpg', quality=100)
    else:
        frames[0].save(pics/'opening.jpg', quality=95, subsampling=0)
    sheet_count = math.ceil(len(starts) / PER_SHEET)
    materials = [material('Walnut', (.076,.038,.020), .62),
                 material('Bronze', (.37,.27,.13), .44, .62),
                 material('Paper', (.83,.78,.65), .96),
                 film_material(sheet_count)]
    geometry = [
        molding('Frame',[(.67,.411,0),(.67,.411,.014),(.664,.405,.023),(.643,.384,.023),(.634,.375,.0163)],'Walnut',True),
        molding('Brass',[(.639,.380,.0185),(.637,.378,.0193),(.635,.376,.0178)],'Bronze'),
        mesh('Mat',rectangle(.635,.376,.0158),[0,1,2,0,2,3],'Paper'),
        film_plane(starts)
    ]
    files = ['images/opening.jpg']
    pixels = 0
    for number, first in enumerate(range(0, len(frames), PER_SHEET)):
        subset = frames[first:first+PER_SHEET]
        file = f'images/reel-{number:02d}.jpg'
        size = pack_sheet(subset, out/file, 100 if diagnostic else 91)
        pixels += size[0]*size[1]
        files.append(file)
    # Preserve the AAC bitstream and its stereo channel layout.
    require_command(ffmpeg(),'-v','error','-nostdin','-y','-i',str(source),'-map','0:a:0','-vn','-c:a','copy',str(out/'soundtrack.m4a'))
    stage = [f'''#usda 1.0
(
    defaultPrim = "MoeckelWallFilm"
    metersPerUnit = 1
    upAxis = "Y"
    timeCodesPerSecond = {FPS}
    framesPerSecond = {FPS}
    startTimeCode = 0
    endTimeCode = {SOURCE_FRAMES}
    autoPlay = true
    playbackMode = "loop"
)
def Xform "MoeckelWallFilm" (prepend apiSchemas = ["Preliminary_AnchoringAPI"]) {{
    uniform token preliminary:anchoring:type = "plane"
    uniform token preliminary:planeAnchoring:alignment = "vertical"
    def Scope "Materials" {{
''', '\n'.join(materials), '}', '\n'.join(geometry), '''
    def SpatialAudio "Soundtrack" {
        uniform asset filePath = @soundtrack.m4a@
        uniform token auralMode = "nonSpatial"
        uniform token playbackMode = "onceFromStart"
        uniform timecode startTime = 0
        uniform double mediaOffset = 0
        double gain = 1
    }
}
''']
    (out/'WallFilm.usda').write_text('\n'.join(stage))
    require_command('usdcat','WallFilm.usda','-o','WallFilm.usdc',cwd=out)
    name = 'identity-test.usdz' if diagnostic else 'moeckel-wall-film-whole.usdz'
    require_command('usdzip', name, 'WallFilm.usdc','soundtrack.m4a',*files,cwd=out)
    require_command('usdchecker','--arkit','--strict', name,cwd=out)
    manifest = {
        'width':WIDTH,'height':HEIGHT,'timeCodesPerSecond':FPS,'sourceFrames':SOURCE_FRAMES,
        'displayedImages':len(starts),'wholeFrameSourceIndices':starts,'maxHoldFrames':MAX_HOLD,
        'longestMeasuredHoldFrames':max(np.diff(starts+[SOURCE_FRAMES]).tolist()),
        'maximumRMSFromHeldSource':max_error,'textureMiB':round(pixels*4/2**20,3),
        'packageBytes':(out/name).stat().st_size,
        'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest()
    }
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:v for k,v in manifest.items() if k!='wholeFrameSourceIndices'},indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('film',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--diagnostic',action='store_true',help='build a flat-color surface identity test')
    args = parser.parse_args()
    write_stage(args.film.resolve(), args.output.resolve(), diagnostic=args.diagnostic)
