import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const remoteUrl = process.env.SITES_REMOTE_URL;
const token = process.env.SITES_TOKEN;
const branch = process.env.SITES_BRANCH || "main";

if (!remoteUrl || !token) {
  throw new Error("SITES_REMOTE_URL and SITES_TOKEN are required.");
}

const sourceFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "service-worker.js",
  "icon.svg",
  ".openai/hosting.json",
  "scripts/build-site.mjs",
  "scripts/push-source.mjs",
  "public/screenshot.jpeg",
];

const objectTypes = {
  commit: 1,
  tree: 2,
  blob: 3,
};

const objects = [];

function sha1(buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

function hashObject(type, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const store = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
  const id = sha1(store);
  objects.push({ id, type, content: body });
  return id;
}

function shaToBuffer(id) {
  return Buffer.from(id, "hex");
}

function makeTree() {
  const rootNode = { files: [], dirs: new Map() };

  function addFile(filePath, id) {
    const parts = filePath.split("/");
    let node = rootNode;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { files: [], dirs: new Map() });
      node = node.dirs.get(part);
    }
    node.files.push({ name: parts.at(-1), id });
  }

  function writeTree(node) {
    const entries = [];
    for (const [name, child] of node.dirs) {
      entries.push({ mode: "40000", name, id: writeTree(child) });
    }
    for (const file of node.files) {
      entries.push({ mode: "100644", ...file });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const body = Buffer.concat(
      entries.flatMap((entry) => [
        Buffer.from(`${entry.mode} ${entry.name}\0`),
        shaToBuffer(entry.id),
      ])
    );
    return hashObject("tree", body);
  }

  return { addFile, writeTree: () => writeTree(rootNode) };
}

const tree = makeTree();
for (const file of sourceFiles) {
  const body = await readFile(join(root, file));
  tree.addFile(file, hashObject("blob", body));
}

const treeId = tree.writeTree();
const timestamp = Math.floor(Date.now() / 1000);
const commitBody = `tree ${treeId}
author Codex <codex@example.com> ${timestamp} +0000
committer Codex <codex@example.com> ${timestamp} +0000

Deploy Trafikalarm prototype
`;
const commitId = hashObject("commit", commitBody);

function encodePackObjectHeader(type, size) {
  let first = (objectTypes[type] << 4) | (size & 0x0f);
  size >>= 4;
  const bytes = [];
  while (size > 0) {
    first |= 0x80;
    bytes.push(first);
    first = size & 0x7f;
    size >>= 7;
  }
  bytes.push(first);
  return Buffer.from(bytes);
}

function makePack() {
  const header = Buffer.alloc(12);
  header.write("PACK", 0, "ascii");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(objects.length, 8);
  const chunks = [header];
  for (const object of objects) {
    chunks.push(encodePackObjectHeader(object.type, object.content.length));
    chunks.push(deflateSync(object.content));
  }
  const packWithoutChecksum = Buffer.concat(chunks);
  const checksum = createHash("sha1").update(packWithoutChecksum).digest();
  return Buffer.concat([packWithoutChecksum, checksum]);
}

function pktLine(value) {
  const body = Buffer.from(value);
  const length = (body.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length), body]);
}

async function requestWithAuth(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status !== 401) return response;

  const basicHeaders = new Headers(options.headers || {});
  basicHeaders.set("authorization", `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`);
  return fetch(url, { ...options, headers: basicHeaders });
}

const infoResponse = await requestWithAuth(`${remoteUrl}/info/refs?service=git-receive-pack`, {
  headers: { accept: "*/*" },
});
if (!infoResponse.ok) {
  throw new Error(`info/refs failed: ${infoResponse.status} ${await infoResponse.text()}`);
}

const info = Buffer.from(await infoResponse.arrayBuffer()).toString("binary");
const refLine = info
  .split("\n")
  .find((line) => line.includes(`refs/heads/${branch}`));
const oldId = refLine ? refLine.match(/[0-9a-f]{40}/)?.[0] : "0000000000000000000000000000000000000000";

const command = `${oldId} ${commitId} refs/heads/${branch}\0 report-status-v2 side-band-64k object-format=sha1 agent=codex-sites\n`;
const body = Buffer.concat([pktLine(command), Buffer.from("0000"), makePack()]);

const pushResponse = await requestWithAuth(`${remoteUrl}/git-receive-pack`, {
  method: "POST",
  headers: {
    "content-type": "application/x-git-receive-pack-request",
    accept: "application/x-git-receive-pack-result",
  },
  body,
});

const responseBody = Buffer.from(await pushResponse.arrayBuffer()).toString("utf8");
if (!pushResponse.ok || !responseBody.includes("unpack ok")) {
  throw new Error(`push failed: ${pushResponse.status} ${responseBody}`);
}

console.log(commitId);
