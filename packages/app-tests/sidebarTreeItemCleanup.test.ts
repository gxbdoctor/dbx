import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { compileScript, parse } from "vue/compiler-sfc";

const treeItem = readFileSync("apps/desktop/src/components/sidebar/TreeItem.vue", "utf8");

test("sidebar row template components have script bindings", () => {
  const descriptor = parse(treeItem).descriptor;
  const bindings = compileScript(descriptor, { id: "sidebar-tree-item" }).bindings;
  const template = descriptor.template;
  assert.ok(template);

  const componentTags = new Set(Array.from(template.content.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g), (match) => match[1]));

  for (const tag of componentTags) assert.ok(bindings[tag], `TreeItem template component ${tag} must be imported`);
});

test("recycled sidebar rows re-register paste handlers by node id", () => {
  assert.ok(treeItem.indexOf("const sidebarTreeContext = inject") < treeItem.indexOf("const stopPasteHandlerRegistration = watch"));
  assert.match(treeItem, /watch\(\s*\(\) => props\.node\.id,/);
  assert.match(treeItem, /registerPasteHandler\?\.\(nodeId, \(\) => treeRuntime\.requestPaste\(props\.node\)\)/);
  assert.match(treeItem, /if \(unregister\) onCleanup\(unregister\)/);
});

test("connection group rename requests are owned by the rendered row", () => {
  const runtimeHost = readFileSync("apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue", "utf8");
  const connectionMutationRuntime = readFileSync("apps/desktop/src/composables/useSidebarConnectionMutationRuntime.ts", "utf8");
  const connectionTree = readFileSync("apps/desktop/src/components/sidebar/ConnectionTree.vue", "utf8");

  assert.match(treeItem, /const renameInputRef = ref<HTMLInputElement>\(\)/);
  assert.match(treeItem, /watch\(\s*\(\) => props\.pendingRename,[\s\S]*?startRenameGroup\(\)/);
  assert.match(treeItem, /focusSidebarRenameInput\(\(\) => \(isRenamingGroup\.value \? renameInputRef\.value : undefined\)\)/);
  assert.match(runtimeHost, /requestGroupRename: \(groupId\) => emit\("request-group-rename", groupId\)/);
  assert.match(connectionMutationRuntime, /options\.requestGroupRename\(activeNode\.value\.id\)/);
  assert.doesNotMatch(runtimeHost, /const isRenamingGroup = ref\(/);
  assert.match(connectionTree, /@request-group-rename="startRenamingCreatedGroup"/);
});

test("sidebar row unmount clears row state and releases drag ownership", () => {
  const dragController = readFileSync("apps/desktop/src/lib/sidebar/sidebarVirtualGroupDrag.ts", "utf8");
  assert.match(treeItem, /function handleMouseLeave\(\)[\s\S]*?labelResizeObserver\?\.disconnect\(\)/);
  assert.match(treeItem, /function finishTableReferenceDrag\(\) \{\s*sidebarObjectDrag\.releaseSource\(\);\s*\}/);
  assert.match(treeItem, /onBeforeUnmount\(\(\) => \{[\s\S]*?stopPasteHandlerRegistration\(\)[\s\S]*?handleMouseLeave\(\)[\s\S]*?finishTableReferenceDrag\(\)/);
  assert.match(treeItem, /watch\([\s\S]*?\(\) => props\.node,[\s\S]*?finishTableReferenceDrag\(\)/);

  // A recycled row relinquishes its callback without ending an active drag.
  // The gesture controller owns document listeners and releases them when the
  // gesture ends, including after the original row has disappeared.
  assert.match(dragController, /releaseSource\(\) \{\s*if \(active\) sourceAttached = false;\s*else finish\(\);\s*\}/);
  const finish = dragController.match(/function finish\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(finish);
  for (const event of ["mousemove", "mouseup", "keydown"]) {
    assert.ok(finish.includes(`doc.removeEventListener("${event}",`), `${event} listener must be released`);
  }
  assert.match(finish, /viewport\.removeEventListener\("blur", finish\)/);
  assert.match(finish, /clearHighlight\(\)/);
  assert.match(finish, /feedback\?\.end\(\)/);
  assert.match(finish, /clearActiveTableReferencePayload\(payload\)/);
  assert.match(finish, /if \(sourceAttached\) options\.onDragEnd\(\)/);
});

test("sidebar rows do not own dialog templates or eager dialog state", () => {
  const runtimeHost = readFileSync("apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue", "utf8");
  assert.doesNotMatch(treeItem, /<Dialog(?:\s|>)/);
  assert.doesNotMatch(treeItem, /<DangerConfirmDialog/);
  assert.doesNotMatch(treeItem, /const show[A-Z][A-Za-z]+(?:Dialog|Confirm) = ref\(/);
  assert.doesNotMatch(treeItem, /function getTreeItemDialogController\(\)/);
  assert.match(treeItem, /inject\(sidebarTreeRuntimeKey\)/);
  assert.match(runtimeHost, /function getTreeItemDialogController\(\)/);
  assert.match(runtimeHost, /if \(treeItemDialogController\) return treeItemDialogController/);
});
