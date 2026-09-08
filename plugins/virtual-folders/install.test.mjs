import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isSameDirectory } from "./install.mjs";

const addonDir = dirname(fileURLToPath(import.meta.url));
const original = Array.from({ length: 24 }, (_, i) => `export const value${i} = ${i};`).join("\n") + "\n";
const augmented = original.replace("export const value2 = 2;", "export const value2 = 2;\nexport const virtualFolders = true;");
const appFile = "apps/desktop/src/app.ts";
const newFile = "apps/desktop/src/virtualFolders.ts";

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  return result;
}

function success(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout || "Command failed without output.");
  return result;
}

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "dbx-addon-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = resolve(root, "source");
  const addon = resolve(root, "addon");
  mkdirSync(resolve(target, "apps/desktop/src"), { recursive: true });
  mkdirSync(resolve(target, "src-tauri"));
  mkdirSync(addon);
  writeFileSync(resolve(target, "src-tauri/tauri.conf.json"), '{"identifier":"com.dbx.app"}');
  writeFileSync(resolve(target, appFile), original);
  success(run("git", ["init", "-q"], target));
  success(run("git", ["add", "."], target));
  writeFileSync(resolve(target, appFile), augmented);
  const patch = run("git", ["diff", "--", appFile], target).stdout + `diff --git a/${newFile} b/${newFile}\nnew file mode 100644\n--- /dev/null\n+++ b/${newFile}\n@@ -0,0 +1 @@\n+export const pluginName = "Virtual Folders";\n`;
  writeFileSync(resolve(target, appFile), original);
  const manifest = {
    schemaVersion: 1, kind: "dbx-source-addon", baseCommit: "fixture",
    patchSha256: createHash("sha256").update(patch).digest("hex"), files: [appFile, newFile],
  };
  copyFileSync(resolve(addonDir, "install.mjs"), resolve(addon, "install.mjs"));
  writeFileSync(resolve(addon, "payload.patch"), patch);
  writeFileSync(resolve(addon, "manifest.json"), JSON.stringify(manifest));
  const install = (command) => run(process.execPath, [resolve(addon, "install.mjs"), command, "--target", target], root);
  return { root, target, addon, install };
}

test("preflight does not mutate files; repeated apply/remove are idempotent", (t) => {
  const { target, install } = fixture(t);
  assert.match(success(install("check")).stdout, /COMPATIBLE/);
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), original);
  assert.equal(existsSync(resolve(target, newFile)), false);
  success(install("apply"));
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), augmented);
  assert.equal(existsSync(resolve(target, newFile)), true);
  assert.match(success(install("apply")).stdout, /ALREADY INSTALLED/);
  assert.match(success(install("status")).stdout, /INSTALLED/);
  success(install("remove"));
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), original);
  assert.equal(existsSync(resolve(target, newFile)), false);
  assert.match(success(install("remove")).stdout, /ALREADY REMOVED/);
});

test("conflicting source fails before creating any add-on file", (t) => {
  const { target, install } = fixture(t);
  const changed = original.replace("value2 = 2", "value2 = 200");
  writeFileSync(resolve(target, appFile), changed);
  const result = install("apply");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No files were changed/);
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), changed);
  assert.equal(existsSync(resolve(target, newFile)), false);
});

test("removal preserves unrelated edits in the same source file and saved data", (t) => {
  const { target, install } = fixture(t);
  success(install("apply"));
  writeFileSync(resolve(target, appFile), augmented.replace("value23 = 23", "value23 = 999"));
  mkdirSync(resolve(target, "data"));
  writeFileSync(resolve(target, "data/folders.json"), '{"groups":["AKI"]}');
  success(install("remove"));
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), original.replace("value23 = 23", "value23 = 999"));
  assert.equal(readFileSync(resolve(target, "data/folders.json"), "utf8"), '{"groups":["AKI"]}');
});

test("removal refuses to delete an add-on file with user edits and rolls back nothing partially", (t) => {
  const { target, install } = fixture(t);
  success(install("apply"));
  writeFileSync(resolve(target, newFile), "// user's extra logic\n");
  const result = install("remove");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No files were changed/);
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), augmented);
  assert.equal(readFileSync(resolve(target, newFile), "utf8"), "// user's extra logic\n");
});

test("tampered payload is rejected before source mutation", (t) => {
  const { target, addon, install } = fixture(t);
  writeFileSync(resolve(addon, "payload.patch"), "corrupt patch\n");
  const result = install("apply");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum/);
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), original);
});

test("installation refuses a binary installation folder without a Git checkout", (t) => {
  const { root, addon } = fixture(t);
  const result = run(process.execPath, [resolve(addon, "install.mjs"), "apply", "--target", root], root);
  assert.equal(result.status, 1);
});

test("directory aliases identify the same checkout but never its subdirectories", (t) => {
  const { root, target, addon } = fixture(t);
  const alias = resolve(root, "source-alias");
  symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(isSameDirectory(target, alias), true);
  assert.equal(isSameDirectory(target, resolve(target, "apps")), false);
  const result = success(run(process.execPath, [resolve(addon, "install.mjs"), "check", "--target", alias], root));
  assert.match(result.stdout, /COMPATIBLE/);
  assert.equal(existsSync(resolve(target, newFile)), false);
});

test("a subdirectory of a DBX checkout is rejected before patching", (t) => {
  const { root, target, addon } = fixture(t);
  const result = run(process.execPath, [resolve(addon, "install.mjs"), "apply", "--target", resolve(target, "apps")], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be the root/);
  assert.match(result.stderr, /Selected:/);
  assert.match(result.stderr, /Git root:/);
  assert.equal(readFileSync(resolve(target, appFile), "utf8"), original);
  assert.equal(existsSync(resolve(target, newFile)), false);
});

test("packaging is identical before and after new source files are staged", (t) => {
  const { target, root, install } = fixture(t);
  success(run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "base"], target));
  const base = run("git", ["rev-parse", "HEAD"], target).stdout.trim();
  success(install("apply"));
  const targetAddon = resolve(target, "plugins/virtual-folders");
  mkdirSync(targetAddon, { recursive: true });
  for (const name of ["package.mjs", "README.md", "Install.cmd", "Uninstall.cmd", "install.mjs"]) {
    copyFileSync(resolve(addonDir, name), resolve(targetAddon, name));
  }
  const firstZip = resolve(root, "before.zip");
  const secondZip = resolve(root, "after.zip");
  success(run(process.execPath, [resolve(targetAddon, "package.mjs"), "--base", base, "--output", firstZip], target));
  success(run("git", ["add", "apps/desktop/src"], target));
  success(run(process.execPath, [resolve(targetAddon, "package.mjs"), "--base", base, "--output", secondZip], target));
  assert.deepEqual(readFileSync(firstZip), readFileSync(secondZip));
});
