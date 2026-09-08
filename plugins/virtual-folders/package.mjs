#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const addonDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(addonDir, "../..");
const args = process.argv.slice(2);
let base = "5814ff008882c57c275166431c3d9ef9055a9aa7";
let output = resolve(root, "artifacts/DBX-Virtual-Folders-source-addon.zip");
while (args.length) {
  const arg = args.shift();
  if (arg === "--base" && args.length) base = args.shift();
  else if (arg === "--output" && args.length) output = resolve(args.shift());
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}

function git(args, allowed = [0]) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (result.error || !allowed.includes(result.status)) throw new Error(result.error?.message || result.stderr);
  return result.stdout;
}

// This scope intentionally excludes backend/updater code and CI/build settings.
const sourceScope = "apps/desktop/src";
base = git(["rev-parse", "--verify", `${base}^{commit}`]).trim();
const tracked = git(["diff", "--no-renames", "--name-only", "-z", base, "--", sourceScope]).split("\0").filter(Boolean);
const untracked = git(["ls-files", "--others", "--exclude-standard", "-z", "--", sourceScope]).split("\0").filter(Boolean).sort();
const filesInPatch = [...new Set([...tracked, ...untracked])].sort();
const untrackedSet = new Set(untracked);
// Per-file sorted diffs stay byte-identical before and after newly added files
// are staged/committed, so CI can faithfully reproduce a developer's package.
let patch = "";
for (const path of filesInPatch) {
  patch += untrackedSet.has(path)
    ? git(["diff", "--no-ext-diff", "--no-textconv", "--no-index", "--binary", "--", "/dev/null", path], [1])
    : git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary", base, "--", path]);
}
if (!patch.trim()) throw new Error("No source changes to package.");
const manifest = {
  schemaVersion: 1,
  kind: "dbx-source-addon",
  id: "virtual-folders",
  version: "0.2.0",
  baseCommit: base,
  patchSha256: createHash("sha256").update(patch).digest("hex"),
  files: filesInPatch,
};
writeFileSync(resolve(addonDir, "payload.patch"), patch);
writeFileSync(resolve(addonDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Store-only ZIP keeps the downloadable bundle reproducible and works on Node
// without platform-specific zip commands or third-party package dependencies.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01, fixed for reproducibility.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const files = ["README.md", "Install.cmd", "Uninstall.cmd", "install.mjs", "manifest.json", "payload.patch"];
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, zip(files.map((name) => [name, Buffer.from(readFileSync(resolve(addonDir, name), "utf8").replace(/\r\n/g, "\n"))])));
console.log(`Packaged ${manifest.files.length} source files for base ${base}: ${output}`);
