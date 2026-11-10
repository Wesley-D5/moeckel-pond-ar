// Optional developer build. The published page serves these prebuilt, local modules.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { access, cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const published = process.argv[2]
  ? path.resolve(process.argv[2])
  : existsSync(path.join(root, "index.html"))
    ? root
    : path.join(root, "dist");
await access(path.join(published, "index.html"));
const scratch = await mkdtemp(path.join(tmpdir(), "moeckel-bundle-"));
const common = {
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  legalComments: "eof",
};

try {
  await build({
    ...common,
    entryPoints: [path.join(here, "preview/preview.js")],
    outfile: path.join(scratch, "preview.js"),
  });
  await build({
    ...common,
    entryPoints: { wall: path.join(here, "wall-camera/src/index.js") },
    splitting: true,
    outdir: path.join(scratch, "wall"),
    chunkNames: "parts/[name]-[hash]",
  });
  await cp(
    path.join(scratch, "preview.js"),
    path.join(published, "preview/preview.js"),
  );
  const wall = path.join(published, "wall");
  await mkdir(wall, { recursive: true });
  await cp(path.join(scratch, "wall"), wall, { recursive: true });
  await cp(
    path.join(here, "wall-camera/wall.css"),
    path.join(wall, "wall.css"),
  );
  const current = new Set(await readdir(path.join(scratch, "wall/parts")));
  for (const file of await readdir(path.join(wall, "parts"))) {
    if (!current.has(file)) await rm(path.join(wall, "parts", file));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
