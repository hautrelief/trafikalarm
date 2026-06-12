import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dist = join(root, "dist");
const assets = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "service-worker.js",
  "icon.svg",
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "server"), { recursive: true });
await mkdir(join(dist, "server", "public"), { recursive: true });
await mkdir(join(dist, ".openai"), { recursive: true });

const embedded = {};
for (const file of assets) {
  embedded[`/${file}`] = {
    body: await readFile(join(root, file), "utf8"),
    type: mimeTypes[extname(file)] || "application/octet-stream",
  };
}
embedded["/"] = embedded["/index.html"];

const workerSource = `const ASSETS = ${JSON.stringify(embedded)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.endsWith("/") && url.pathname !== "/" ? url.pathname.slice(0, -1) : url.pathname;
    const asset = ASSETS[path] || ASSETS[path + ".html"] || ASSETS["/index.html"];
    const headers = new Headers({
      "content-type": asset.type,
      "cache-control": path === "/index.html" || path === "/" ? "no-store" : "public, max-age=3600",
    });
    return new Response(asset.body, { headers });
  },
};
`;

await writeFile(join(dist, "server", "index.js"), workerSource);
await writeFile(join(dist, ".openai", "hosting.json"), await readFile(join(root, ".openai", "hosting.json"), "utf8"));

const screenshot = join(root, "public", "screenshot.jpeg");
if (await stat(screenshot).then(() => true).catch(() => false)) {
  await copyFile(screenshot, join(dist, "server", "public", "screenshot.jpeg"));
}

const functionsDir = join(root, "functions");
if (await stat(functionsDir).then((item) => item.isDirectory()).catch(() => false)) {
  await cp(functionsDir, join(dist, "functions"), { recursive: true });
}
