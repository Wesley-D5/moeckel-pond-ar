# Moeckel Pond Seasons: web AR

Live at **https://wesley-d5.github.io/moeckel-pond-ar/**

A static website. People open it on their phone and either:

- **Scan the poster**: point the camera at the printed poster (the video's first frame). The video plays on top of it, locked to the paper.
- **Hang it on a wall**: tap any wall and the video stays fixed there in 3D, even as you walk around.

Built on the **8th Wall engine** (Niantic Spatial), self-hosted from this folder, with three.js.

## Devices

| Device | Scan the poster | Hang it on a wall |
|---|---|---|
| iPhone / iPad (Safari, iOS 16.4+) | ✅ | ✅ world tracking |
| Android (Chrome, Samsung Internet, Firefox, Edge) | ✅ | ✅ world tracking |
| Laptop / desktop | ✅ with a webcam | Shows a QR code to open it on a phone |

Browsers can't use the iPhone's LiDAR (Apple doesn't expose it to the web), so 8th Wall tracks
the world from the camera image and motion sensors instead. On a plain, featureless white wall
it can't measure the wall's angle, so the video faces you at about 1.5 m. Textured walls (brick,
wood, posters, frames) give the best fit.

## Hosting

Free on GitHub Pages: no server, HTTPS included (the camera needs it), and nothing to renew.
Every library and media file is in this folder, and the engine makes no calls to outside services
for the features used here.

## Files

- `index.html`, `app.js`, `style.css`: the site
- `assets/poster.jpg`: the poster (first frame of the video). Print this.
- `assets/poster-540.mp4`: the video (keep it under 25 MB for GitHub's web uploader)
- `image-targets/poster.json` + `poster_luminance.jpg`: the tracking data for the poster
- `vendor/8thwall/`: the 8th Wall engine binary (do not modify, per its license)
- `vendor/xrextras/`: 8th Wall's loading and permission screens (MIT)
- `vendor/three/`: three.js r183 (MIT)

## Changing the poster or video

- New video: replace `assets/poster-540.mp4`, keeping 16:9.
- New poster image: replace `assets/poster.jpg`, then regenerate the tracking data with 8th Wall's tool:

  ```
  npx @8thwall/image-target-cli@latest
  ```

  Answer: the path to `assets/poster.jpg`, `flat`, `Y` (default crop), output folder `image-targets`,
  name `poster`. Commit the new `image-targets/poster.json` and `poster_luminance.jpg`.

## Printing tips

- Print `assets/poster.jpg` exactly, on matte paper if possible; glare hurts tracking.
- The engine tracks the centre 4:3 area of the poster, so don't cover the middle with text or logos.
- A4/Letter or bigger works best.

## License notes

This product includes the XR Engine software developed by Niantic Spatial, Inc.
Copyright © 2026 Niantic Spatial, Inc. All rights reserved.
License: https://github.com/8thwall/engine/blob/main/LICENSE. The engine is provided "as is",
without warranty; see the license. Free for this use: it may not be used in a paid product whose
value comes mainly from the engine.
