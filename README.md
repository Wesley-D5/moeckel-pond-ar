# Moeckel Pond Seasons: web AR

A static website. People open it on their phone and either:

- **Scan the poster**: point the camera at the printed poster (the video's first frame). The video plays right on top of it, locked to the paper.
- **Hang it on a wall**: put the video on any wall around them.

## Which phones get what

| Device | Scan the poster | Hang it on a wall |
|---|---|---|
| iPhone / iPad (Safari, Chrome) | ✅ | Gyro mode: stays put while you look around, drifts if you walk |
| Android (Chrome, ARCore phones) | ✅ | ✅ Real wall anchoring (WebXR) |
| Laptop | ✅ with webcam | Shows a QR code to open on a phone |

Browsers can't use the iPhone's LiDAR. Apple only gives LiDAR to native apps and AR Quick Look,
and AR Quick Look can't play video. If a future Safari adds WebXR AR, this page will use it
automatically.

## Hosting for free, forever (GitHub Pages)

Everything (three.js, MindAR, the video) is stored in this folder. Nothing loads from outside
services, so nothing can break when another company shuts something down.

1. Create a free account at github.com, then click **New repository**. Name it e.g. `moeckel-pond-ar` and set it to **Public**.
2. Click **uploading an existing file** and drag in *everything inside this folder*, keeping the folders as they are. Click **Commit**.
3. Go to **Settings → Pages**, then under *Branch* choose `main` / `(root)` and **Save**.
4. After about a minute the site is live at `https://YOUR-NAME.github.io/moeckel-pond-ar/`.
5. Print a QR code of that URL on or next to the poster (the page shows one when opened on a computer).

Cost: $0. No servers to manage, HTTPS included (the camera needs it). Optional: a custom
domain costs about $10–15 a year, but it's one more thing that can expire. The free
`github.io` address never expires.

## Changing the poster or video

- New video: replace `assets/poster-540.mp4` (keep it under 25 MB, 16:9).
- New poster image: replace `assets/target.jpg` and `assets/poster.jpg`, then open
  `tools/compile-target.html` on the live site, click **Use assets/target.jpg**, and upload the
  `target.mind` file it downloads into `assets/`.

## Tips for the printed poster

- Print the exact first frame (`assets/poster.jpg`), matte paper if you can; glare hurts tracking.
- Bigger is easier to detect. A4/Letter and up works well.

Built with MindAR 1.2.5 (MIT) and three.js r160 (MIT).
