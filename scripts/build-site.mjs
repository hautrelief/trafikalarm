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
  "public/app-icon-96.png",
  "public/app-icon-192.png",
  "public/app-icon-512.png",
  "public/mobilepay-qr.png",
  "public/login-background.jpg",
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "server"), { recursive: true });
await mkdir(join(dist, "server", "public"), { recursive: true });
await mkdir(join(dist, ".openai"), { recursive: true });

const embedded = {};
for (const file of assets) {
  embedded[`/${file}`] = {
    body: await readFile(join(root, file), "base64"),
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
    const noStore = ["/", "/index.html", "/app.js", "/styles.css", "/manifest.json", "/service-worker.js"].includes(path);
    const headers = new Headers({
      "content-type": asset.type,
      "cache-control": noStore ? "no-store" : "public, max-age=3600",
    });
    const body = Uint8Array.from(atob(asset.body), (char) => char.charCodeAt(0));
    return new Response(body, { headers });
  },
};
`;

await writeFile(join(dist, "server", "index.js"), workerSource);
await writeFile(join(dist, ".openai", "hosting.json"), await readFile(join(root, ".openai", "hosting.json"), "utf8"));

const screenshot = join(root, "public", "screenshot.jpeg");
if (await stat(screenshot).then(() => true).catch(() => false)) {
  await copyFile(screenshot, join(dist, "server", "public", "screenshot.jpeg"));
}

const mobilepayQr = join(root, "public", "mobilepay-qr.png");
if (await stat(mobilepayQr).then(() => true).catch(() => false)) {
  await copyFile(mobilepayQr, join(dist, "server", "public", "mobilepay-qr.png"));
}

const loginBackground = join(root, "public", "login-background.jpg");
if (await stat(loginBackground).then(() => true).catch(() => false)) {
  await copyFile(loginBackground, join(dist, "server", "public", "login-background.jpg"));
}

for (const size of [96, 192, 512]) {
  const icon = join(root, "public", `app-icon-${size}.png`);
  if (await stat(icon).then(() => true).catch(() => false)) {
    await copyFile(icon, join(dist, "server", "public", `app-icon-${size}.png`));
  }
}

const functionsDir = join(root, "functions");
if (await stat(functionsDir).then((item) => item.isDirectory()).catch(() => false)) {
  await cp(functionsDir, join(dist, "functions"), { recursive: true });
}
