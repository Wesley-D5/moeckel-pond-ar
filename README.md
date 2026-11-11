# Moeckel Pond

[Place the film on a wall](https://wesley-d5.github.io/moeckel-pond-ar/#wall) · [Explore the miniature](https://wesley-d5.github.io/moeckel-pond-ar/#miniature)

This static site presents the 41-second Moeckel Pond film and a tabletop mill modeled from the reference photograph. All camera processing stays on the device.

## Wall film

On a Quick Look-capable iPhone or iPad running version 18 or later, **Place on wall** opens the native Apple viewer directly. Choose AR, aim at a vertical surface, and position the framed film. The USDZ uses whole images and includes the original AAC soundtrack.

The [original MP4 wall player](https://wesley-d5.github.io/moeckel-pond-ar/#original-film) decodes the full 960 × 540, 24 fps film in the browser. It is also the normal phone route where the animated Quick Look edition is unsupported. WebXR can detect vertical surfaces on compatible devices. The local JSFeat tracker can follow a textured wall, recover when its features return, and release the camera on close.

## Miniature

The projecting gabled building and long wing are modeled as connected volumes above separate masonry piers. The retaining wall runs along the left bank. The island extends from the left midground into the right foreground. Edge trees leave a clear roofline. The plinth has an unillustrated finish.

The USDZ opens in Apple Quick Look. The matching GLB powers the interactive browser preview and compatible Android placement. The geometry is an interpretation from one photograph. The unseen faces are inferred.

## Hosting and source

Serve the directory containing `index.html` from an HTTPS static host. GitHub Pages publishes the repository root. The companion Sites checkout publishes `dist/`. The new entry script is `pond.js`. Preserve byte-range support for the MP4 and serve USDZ as `model/vnd.usdz+zip`.

The browser wall player, miniature viewer and native asset generators are in `authoring/`. Generated assets are checked in. To rebuild the browser modules, run `npm ci` and `npm run bundle` from `authoring/`. Asset generation runs offline and is optional for hosting.

The application and our asset generators are MIT licensed. The bundled JSFeat, Three.js and fonts retain their original notices. The supplied footage, photographs, soundtrack and derivative image textures retain their original rights.

## Regenerating the assets

The following commands use the GitHub Pages checkout layout. They require Python, Pillow, NumPy, FFmpeg and OpenUSD command-line tools. Use `dist/assets/` for published media in the companion Sites checkout.

```sh
python3 authoring/wall-film/build.py assets/poster-540.mp4 authoring/wall-film/generated
python3 authoring/miniature/build.py authoring/miniature/build
```

The wall generator emits `moeckel-wall-film-whole.usdz`. Its native MaterialX playback requires iOS or iPadOS 18 or later. `#wall` and `#apple-wall` open the native wall route on supported devices. The smaller native edition uses 279 complete 512 × 288 images over the 41.46-second original AAC track.

The miniature generator emits `moeckel-pond-miniature.usdz` and `pond.glb`. The site serves them at `models/moeckel-mill.usdz` and `preview/mill-study.glb`. The modeled façade, roof and masonry textures use perspective-corrected crops of the source photograph.
