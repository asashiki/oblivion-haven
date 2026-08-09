import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "node_modules", "webgal-engine");
const distRoot = join(packageRoot, "dist");
const outputRoot = join(root, "public", "vendor", "webgal");

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (!entry.name.endsWith(".gz") && entry.name !== "index.html") files.push(path);
  }
  return files;
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const sourceFiles = [join(packageRoot, "LICENSE"), ...await walk(distRoot)];
const manifestFiles = [];
for (const source of sourceFiles) {
  const outputPath = source === join(packageRoot, "LICENSE")
    ? "LICENSE"
    : relative(distRoot, source).replaceAll("\\", "/");
  const destination = join(outputRoot, outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
  const bytes = await readFile(destination);
  manifestFiles.push({
    path: outputPath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

manifestFiles.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(outputRoot, "runtime-manifest.json"), `${JSON.stringify({
  schema: "gal-blog-webgal-runtime/v1",
  package: "webgal-engine",
  version: "4.6.2",
  entry: "assets/index-BuN51U1e.js",
  stylesheet: "assets/index-Dch1g2w9.css",
  files: manifestFiles,
}, null, 2)}\n`);

console.log(`Prepared WebGAL 4.6.2 runtime (${manifestFiles.length} files).`);
