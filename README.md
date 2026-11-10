# Moeckel Pond Seasons

Explore the mill through four seasons, play its original 41-second film, scan the printed artwork, or place it on a wall.

[Open the live artwork](https://wesley-d5.github.io/moeckel-pond-ar/) · [Get the print](https://wesley-d5.github.io/moeckel-pond-ar/assets/poster.jpg)

## Camera modes

- **Scan a print** uses the self-hosted 8th Wall Distributed Engine and the original poster target. On supported phones the scanner combines the image pose with world tracking. Small pose changes are filtered, and a brief loss of sight is bridged when the world pose is reliable. Without motion permission, scanning can use image tracking alone.
- **Apple Quick Look** uses vertical-anchored USDZ frames. The four-season asset uses a RealityKit MaterialX shader to crossfade seasonal images over 40 seconds on compatible devices. Other viewers can display the spring material. Each individual season also has a static framed model.
- **Animated wall placement** plays the original film in the browser. On devices with immersive WebXR it uses measured vertical hit-test results and native anchors when available. The 8th Wall path fits a vertical surface to tracked world points and waits for repeated stable measurements. Textured walls in even light work best.
- **Camera photos** are captured from the composited 8th Wall frame when tracking is locked. The camera closes during review. The visitor can download the JPEG or share it using the operating system.
- **Desktop and camera-free viewing** include a depth-based artwork preview, keyboard season selection, film playback and a QR handoff to a phone.

## Local development

Use Node.js and npm. Run `npm ci` and `npm run build` after editing the React components in `src/`. Serve the published files using a static HTTP server on localhost. Device camera testing needs HTTPS.

The React gallery is precompiled. The AR engine, image target, Three.js modules, fonts, seasonal artwork and film are served locally. GPU depth maps are precomputed, so the page does not load a depth estimation model.

## Artwork and tracking data

The original media URLs remain `assets/poster.jpg` and `assets/poster-540.mp4`. Print the full poster with its original proportions. Keep the central mill and shoreline unobstructed.

`content.js` maps season names to film cue points, stills and USDZ files. Each preview image has a matching `-depth.webp` depth map. Changing the print requires regenerating the 8th Wall image target and confirming its crop geometry in `tracking.js`. The full print and its tracked central crop have different aspect ratios.

## Credits

This product includes the XR Engine software developed by Niantic Spatial, Inc. Copyright © 2026 Niantic Spatial, Inc. All rights reserved. The self-hosted distributed engine is provided under its [binary license](https://github.com/8thwall/engine/blob/main/LICENSE). Three.js is distributed under its MIT license. Depth images were generated with Depth Anything V2 Small. License notices accompany the bundled engine, Three.js, React packages and fonts.
