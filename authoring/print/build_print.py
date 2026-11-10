#!/usr/bin/env python3
"""Build the native Moeckel Pond image-anchored seasonal print.

Requires Pillow, ffmpeg and the OpenUSD command-line programs usdcat and usdzip.
Example: python3 build_print.py --poster poster.jpg --film poster-540.mp4 --output living-print.usdz

SPDX-License-Identifier: MIT
Copyright 2026 Moeckel Pond contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of
the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
"""

import argparse
from io import BytesIO
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image

PANELS = 18
FPS = 24
PHASE = 6 * FPS
PADDING = 8


def image_atlas(poster, film, ffmpeg, directory):
    # The first tile also provides the precise untouched reference print separately.
    images = [Image.open(poster).convert("RGB")]
    for second in (11, 23, 33):
        frame = subprocess.check_output([
            ffmpeg, "-loglevel", "error", "-ss", str(second), "-i", str(film),
            "-frames:v", "1", "-vcodec", "png", "-f", "image2pipe", "-"
        ])
        images.append(Image.open(BytesIO(frame)).convert("RGB"))

    width = min(1536, images[0].width)
    height = round(width * images[0].height / images[0].width)
    stride_x, stride_y = width + 2 * PADDING, height + 2 * PADDING
    atlas = Image.new("RGB", (2 * stride_x, 2 * stride_y))
    rectangles = []
    for face, image in enumerate(images):
        tile = image.resize((width, height), Image.Resampling.LANCZOS)
        x = face % 2 * stride_x + PADDING
        y = face // 2 * stride_y + PADDING
        # Extend each boundary pixel into the gutter to isolate mipmap samples.
        atlas.paste(tile, (x, y))
        for bounds, size, at in [
            ((0, 0, width, 1), (width, PADDING), (x, y-PADDING)),
            ((0, height-1, width, height), (width, PADDING), (x, y+height)),
            ((0, 0, 1, height), (PADDING, height), (x-PADDING, y)),
            ((width-1, 0, width, height), (PADDING, height), (x+width, y))
        ]:
            atlas.paste(tile.crop(bounds).resize(size), at)
        for sx, tx in [(0, x-PADDING), (width-1, x+width)]:
            for sy, ty in [(0, y-PADDING), (height-1, y+height)]:
                atlas.paste(tile.getpixel((sx, sy)), (tx, ty, tx+PADDING, ty+PADDING))
        rectangles.append((x / atlas.width, 1 - (y + height) / atlas.height,
                           width / atlas.width, height / atlas.height))
    atlas.save(directory / "seasons.jpg", quality=93, subsampling=0, optimize=True)
    return rectangles, images[0].height / images[0].width


def tuple_text(values):
    return "(" + ", ".join(f"{x:.8f}" for x in values) + ")"


def panel(index, width, height, tiles):
    # ARImageAnchor local coordinates: +X right, -Z up the page, +Y toward the viewer.
    cell = width / PANELS
    r = cell / 2
    h = height / 2
    center = -width / 2 + (index + 0.5) * cell
    corners = [(-r, r, h), (r, r, h), (r, r, -h), (-r, r, -h)]
    points, coordinates = [], []
    for face, (left, bottom, tile_w, tile_h) in enumerate(tiles):
        angle = -face * math.pi / 2
        for x, y, z in corners:
            points.append((x*math.cos(angle)-y*math.sin(angle),
                           x*math.sin(angle)+y*math.cos(angle), z))
        u0 = left + tile_w * index / PANELS
        u1 = left + tile_w * (index+1) / PANELS
        coordinates.extend([(u0, bottom), (u1, bottom), (u1, bottom+tile_h), (u0, bottom+tile_h)])

    # All four faces assemble into the same undistorted 16:9 image at each resting quarter turn.
    # The delayed onset across columns makes each transition travel across the print.
    times = {0: 0.0, 4*PHASE: 360.0}
    for phase in range(4):
        delay = index / (PANELS-1) * 1.15 * FPS
        start = phase*PHASE + 2.7*FPS + delay
        for part in range(9):
            t = part/8
            ease = t*t*(3-2*t)
            times[round(start + 1.15*FPS*t)] = 90*(phase+ease)
    samples = ", ".join(f"{t}: {angle:.6f}" for t, angle in sorted(times.items()))
    vertices = ", ".join(map(tuple_text, points))
    uvs = ", ".join(map(tuple_text, coordinates))
    return f'''
    def Xform "Panel{index+1:02d}"
    {{
        double3 xformOp:translate = {tuple_text((center, 0.0006-r, 0))}
        float xformOp:rotateZ = 0
        float xformOp:rotateZ.timeSamples = {{{samples}}}
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateZ"]
        def Mesh "SeasonFaces" (prepend apiSchemas = ["MaterialBindingAPI"])
        {{
            rel material:binding = </LivingPrint/Artwork>
            uniform token subdivisionScheme = "none"
            int[] faceVertexCounts = [4, 4, 4, 4]
            int[] faceVertexIndices = [{", ".join(map(str, range(16)))}]
            point3f[] points = [{vertices}]
            texCoord2f[] primvars:st = [{uvs}] (interpolation = "vertex")
            float3[] extent = [{tuple_text((-r,-r,-h))}, {tuple_text((r,r,h))}]
        }}
    }}
'''


def scene(width, aspect, rectangles):
    return f'''#usda 1.0
(
    defaultPrim = "LivingPrint"
    metersPerUnit = 1
    upAxis = "Y"
    startTimeCode = 0
    endTimeCode = {4*PHASE}
    timeCodesPerSecond = {FPS}
    framesPerSecond = {FPS}
    autoPlay = true
    playbackMode = "loop"
)
def Xform "LivingPrint" (
    kind = "component"
    prepend apiSchemas = ["Preliminary_AnchoringAPI"]
)
{{
    uniform token preliminary:anchoring:type = "image"
    rel preliminary:imageAnchoring:referenceImage = </LivingPrint/OriginalPoster>
    def Preliminary_ReferenceImage "OriginalPoster"
    {{
        uniform asset image = @original-poster.jpg@
        uniform double physicalWidth = {width}
    }}
    def Material "Artwork"
    {{
        token outputs:surface.connect = </LivingPrint/Artwork/Surface.outputs:surface>
        def Shader "Surface"
        {{
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor.connect = </LivingPrint/Artwork/Ink.outputs:rgb>
            float inputs:roughness = 1
            float inputs:metallic = 0
            token outputs:surface
        }}
        def Shader "Ink"
        {{
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @seasons.jpg@
            token inputs:sourceColorSpace = "sRGB"
            float2 inputs:st.connect = </LivingPrint/Artwork/Coordinates.outputs:result>
            token inputs:wrapS = "clamp"
            token inputs:wrapT = "clamp"
            float3 outputs:rgb
        }}
        def Shader "Coordinates"
        {{
            uniform token info:id = "UsdPrimvarReader_float2"
            string inputs:varname = "st"
            float2 outputs:result
        }}
    }}
''' + "".join(panel(i, width, width*aspect, rectangles) for i in range(PANELS)) + "}\n"


def main():
    parser = argparse.ArgumentParser(description="Author and package the image-anchored seasonal print")
    parser.add_argument("--poster", required=True, type=Path, help="Original unmodified 16:9 poster JPEG")
    parser.add_argument("--film", required=True, type=Path, help="Moeckel Pond seasonal MP4")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--width-meters", type=float, default=0.254)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()
    if not math.isfinite(args.width_meters) or args.width_meters <= 0:
        parser.error("print width must be a positive number")
    with tempfile.TemporaryDirectory(dir=args.output.resolve().parent) as scratch:
        directory = Path(scratch)
        shutil.copyfile(args.poster, directory / "original-poster.jpg")
        rectangles, aspect = image_atlas(args.poster, args.film, args.ffmpeg, directory)
        (directory / "LivingPrint.usda").write_text(scene(args.width_meters, aspect, rectangles))
        subprocess.run(["usdcat", "LivingPrint.usda", "-o", "LivingPrint.usdc"], cwd=directory, check=True)
        subprocess.run(["usdzip", "living-print.usdz", "LivingPrint.usdc", "original-poster.jpg", "seasons.jpg"],
                       cwd=directory, check=True)
        (directory / "living-print.usdz").replace(args.output)


if __name__ == "__main__":
    main()
