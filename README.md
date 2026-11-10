# Moeckel Pond — The Wall Film

[Place the film on your wall](https://wesley-d5.github.io/moeckel-pond-ar/) · [Open the original MP4 wall player](https://wesley-d5.github.io/moeckel-pond-ar/#original-film)

A static, self-hosted artwork. Open the site in Safari on iPhone or iPad and choose **Place the film on a wall**. In Apple Quick Look, select AR and move slowly across a vertical surface. The film runs for 41 seconds with its original soundtrack.

## The two wall players

- **Apple Quick Look** handles world tracking and vertical placement. The self-contained USDZ encodes all 995 source-frame times at 960 × 540 and 24 fps using animated texture tiles. Nearly identical patches reuse texture data. The package includes the original AAC soundtrack. The page launches it using an ordinary `a[rel=ar]` link with one image child. Serve USDZ files with `model/vnd.usdz+zip` and byte-range support.
- **Place the full-quality film with your camera** plays the original 960 × 540, 24 fps MP4 directly. On iPhone, the MIT-licensed JSFeat tracker follows the visible texture of a wall on the device. Face the wall straight on when placing. The film pauses during tracking loss and resumes when the same wall detail returns. On compatible devices WebXR uses measured vertical surfaces. The player has controls to enable sound, move the film and release the camera.

Camera access starts when someone chooses **Open camera** in the browser player. All tracking and rendering happen on the device. The site needs only static hosting.

## Other artwork

The **Living print** USDZ includes its own image anchor for the original spring image at a width of 25.4 cm. Its 18 physical panels turn through four seasons in a 24-second loop. Print the supplied landscape Letter PDF at actual size.

The **Miniature** is an animated 31.6 cm tabletop model. The model and browser preview share their mesh and animation source. Three.js loads on demand to display the GLB. The film, printable artwork, fallback images and handoff codes are served with the site.

## Development

Serve the directory containing `index.html` using a static server. Use HTTPS for device camera testing. GitHub Pages publishes the repository root. The alternative Sites checkout publishes `dist/`. All files needed to view the artwork are checked in.

The optional `authoring/` directory contains the editable camera player, 3D preview and model generators. Run the following in that directory to rebuild the JavaScript modules.

```sh
npm ci
npm run bundle
```

To regenerate the models, install Python 3, Pillow, NumPy, FFmpeg and the OpenUSD CLI tools (`usdcat`, `usdzip`, `usdchecker`). The print PDF additionally uses ReportLab. Run the following from the GitHub Pages repository root.

```sh
python3 authoring/wall-film/build_wall_film.py assets/poster-540.mp4 authoring/wall-film/generated
cp authoring/wall-film/generated/moeckel-wall-film.usdz models/wall-film.usdz
python3 authoring/print/build_print.py --poster assets/poster.jpg --film assets/poster-540.mp4 --output models/living-print.usdz
python3 authoring/make_print.py assets/poster.jpg assets/living-print.pdf
python3 authoring/miniature/build.py
cp authoring/miniature/moeckel-pond-miniature.usdz models/tabletop-mill.usdz
python3 authoring/preview/export-glb.py authoring/miniature/scene.json preview/pond.glb
```

Asset authoring tools run offline. Model regeneration and JavaScript bundling are optional for deployment.

## License

The original application code and effect generators are distributed under the MIT license in `LICENSE`. Licensed dependencies retain their notices in `wall/`, `preview/` and `fonts/`. The supplied film, photographs, soundtrack and their extracted frames retain their original rights. Apple Quick Look is Apple's built-in viewer.
