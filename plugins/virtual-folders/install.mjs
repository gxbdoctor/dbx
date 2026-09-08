#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const addonDir = dirname(fileURLToPath(import.meta.url));

function git(target, args) {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", "-C", target, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`Git is required: ${result.error.message}`);
  return result;
}

function checkedGit(target, args) {
  const result = git(target, args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "Git failed.");
  return result.stdout;
}

function options(args) {
  let command = "apply";
  let target = process.cwd();
  if (args[0] && !args[0].startsWith("--")) command = args.shift();
  while (args.length) {
    const arg = args.shift();
    if (arg === "--target" && args.length) target = args.shift();
    else if (arg === "--help") command = "help";
    else throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (!["apply", "remove", "check", "status", "help"].includes(command)) throw new Error(`Unknown command: ${command}`);
  return { command, target: resolve(target) };
}

function loadPayload(target) {
  const manifest = JSON.parse(readFileSync(resolve(addonDir, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.kind !== "dbx-source-addon" || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error("Unsupported or empty add-on manifest.");
  }
  const patchPath = resolve(addonDir, "payload.patch");
  const patch = readFileSync(patchPath);
  const checksum = createHash("sha256").update(patch).digest("hex");
  if (checksum !== manifest.patchSha256) throw new Error("The add-on patch checksum does not match its manifest. Download the complete add-on again.");

  // This installer can alter only the declared frontend source files. It never
  // accepts executable patches, database files, updater configuration or hooks.
  const entries = checkedGit(target, ["apply", "--numstat", "-z", patchPath]).split("\0").filter(Boolean);
  const actualFiles = entries.map((entry) => {
    const fields = entry.split("\t");
    if (fields.length !== 3 || fields[0] === "-" || fields[1] === "-") throw new Error("Only text source patches are supported.");
    return fields[2];
  });
  for (const path of actualFiles) {
    if (!path.startsWith("apps/desktop/src/") || isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === ".." || part === ".git")) {
      throw new Error(`Unexpected path in source add-on: ${path}`);
    }
  }
  if (new Set(actualFiles).size !== actualFiles.length || JSON.stringify([...actualFiles].sort()) !== JSON.stringify([...manifest.files].sort())) {
    throw new Error("The patch file list does not match its manifest.");
  }
  return { manifest, patchPath };
}

export function main(args = process.argv.slice(2)) {
  const { command, target } = options([...args]);
  if (command === "help") {
    console.log("DBX Virtual Folders SOURCE add-on\nnode install.mjs [check|apply|remove|status] --target <DBX source checkout>\nThis does not modify an installed DBX.exe. After applying, build and install DBX from source.");
    return;
  }
  const root = checkedGit(target, ["rev-parse", "--show-toplevel"]).trim();
  if (relative(realpathSync(root), realpathSync(target)) !== "") throw new Error("--target must be the root of a DBX Git source checkout.");
  try {
    const config = JSON.parse(readFileSync(resolve(target, "src-tauri/tauri.conf.json"), "utf8"));
    if (config.identifier !== "com.dbx.app") throw new Error("Unexpected DBX application identifier.");
  } catch (error) {
    throw new Error(`Select DBX source, not an EXE installation directory. ${error.message}`);
  }
  const { manifest, patchPath } = loadPayload(target);
  const forward = git(target, ["apply", "--check", "--whitespace=nowarn", patchPath]);
  const reverse = git(target, ["apply", "--reverse", "--check", "--whitespace=nowarn", patchPath]);
  const installed = reverse.status === 0;
  const available = forward.status === 0;
  if (installed && available) throw new Error("Ambiguous patch state. No files were changed.");
  if (!installed && !available) {
    throw new Error(`This DBX source version or local edits conflict with the add-on. No files were changed.\nTested source: ${manifest.baseCommit}\n${(command === "remove" ? reverse : forward).stderr.trim()}\nKeep your edits and use a compatible add-on version; this installer does not reset or stash files.`);
  }
  if (command === "status" || command === "check") {
    console.log(installed ? "INSTALLED: Virtual Folders source add-on is present; no files changed." : "COMPATIBLE: the complete add-on can be applied; no files changed.");
    return;
  }
  if (command === "apply" && installed) {
    console.log("ALREADY INSTALLED: no files changed.");
    return;
  }
  if (command === "remove" && available) {
    console.log("ALREADY REMOVED: no files changed.");
    return;
  }
  // git apply is atomic unless --reject is used (intentionally never enabled).
  // Reversal removes only our hunks and refuses to overwrite modified add-on
  // files. Neither direction touches local folder data in the application.
  checkedGit(target, ["apply", ...(command === "remove" ? ["--reverse"] : []), "--whitespace=nowarn", patchPath]);
  console.log(command === "remove"
    ? "REMOVED: source changes reversed; saved virtual folder data is retained. Rebuild DBX to use the change."
    : "APPLIED: Virtual Folders source add-on installed. Run pnpm install --frozen-lockfile, pnpm typecheck and pnpm tauri build to create the enhanced desktop app.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Virtual Folders: ${error.message}`); process.exitCode = 1; }
}
