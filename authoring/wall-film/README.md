# Moeckel Pond native wall film

This native Apple edition plays on one framed surface anchored to a vertical plane. It uses 279 complete images from the original 41.458-second film and its original stereo AAC soundtrack. The frame measures 67 × 41.1 cm at its authored scale.

On iOS or iPadOS 18 or later, open the USDZ in Apple Quick Look for animated playback. The universal USD material displays the opening image in viewers that lack Apple’s MaterialX surface support. The project’s browser wall player uses the original 960 × 540, 24 fps MP4.

## Rebuild

Use Python 3 with NumPy and Pillow, FFmpeg (on PATH or installed via imageio-ffmpeg), and the OpenUSD command-line utilities usdcat, usdzip and usdchecker. Run the generator against the original 995-frame MP4.

```sh
python3 build.py /path/to/poster-540.mp4 ./out
```

The generator writes `out/moeckel-wall-film-whole.usdz`, an inspectable USD scene, JPEG atlas images, the copied soundtrack and a manifest listing every retained source frame. It validates the packaged asset with `usdchecker --arkit --strict`.

The generator code is licensed under the included MIT license. The input artwork, film and soundtrack retain their existing rights.

## Playback

The film surface has four vertices and a single MaterialX material. A USD animation controls the displayed image. The clock animates the axis perpendicular to the surface. The screen’s vertices sit exactly on zero along that axis, keeping the physical rectangle stationary. The shader divides the perpendicular axis length by an in-plane axis length in world space, so normal placement rotation and proportional resizing preserve the selected image. One uniform integer addresses one complete 512 × 288 image on every pixel of the screen.

The original 24 fps timeline advances for its full duration. A new complete image appears when the decoded source changes sufficiently or after six source frames. A local motion check preserves rapid changes such as the bird’s flight. Slow holds last at most 0.25 seconds. The original soundtrack is copied into M4A without audio re-encoding. Safari Quick Look supplies playback and sound controls.

## Verification

A diagnostic build uses a distinct solid color for every complete image, retaining the exact same screen, shader and timeline. It can be built with:

```sh
python3 build.py /path/to/poster-540.mp4 ./identity --diagnostic
```

Apple RealityKit rendered the release and diagnostic packages. Tests covered chronological playback, seeking, former depth-tie phases, oblique views, model rotation and proportional resizing. The diagnostic passed 6,962 independent macOS native poses and 4,475 simulated iOS native poses with zero mixed images, unexpected frames or opening-image fall-through. All 279 expected image identities appeared. Physical iPhone wall registration remains untested.

Apple documents native wall anchoring, playback metadata and the unlit material API in its USD and ShaderGraph references.

- https://developer.apple.com/quick-look-gallery/
- https://developer.apple.com/documentation/usd/autoplay
- https://developer.apple.com/documentation/usd/playbackmode
- https://developer.apple.com/documentation/usd/audio
- https://developer.apple.com/documentation/shadergraph/realitykit/unlit-surface-%28realitykit%29
