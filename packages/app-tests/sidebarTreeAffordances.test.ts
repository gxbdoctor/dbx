import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { syncSidebarTreeNodeExpansion } from "../../apps/desktop/src/lib/sidebar/sidebarTreeExpansion.ts";
import type { TreeNode } from "../../apps/desktop/src/types/database.ts";

const treeItem = readFileSync("apps/desktop/src/components/sidebar/TreeItem.vue", "utf8");
const runtimeHost = readFileSync("apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue", "utf8");
const connectionTree = readFileSync("apps/desktop/src/components/sidebar/ConnectionTree.vue", "utf8");
const connectionStore = readFileSync("apps/desktop/src/stores/connectionStore.ts", "utf8");

test("sidebar rows retain database-specific node affordances", () => {
  for (const nodeType of ["connection", "database", "schema", "table", "column", "mongo-db", "mongo-collection", "redis-db", "nacos-namespace", "mq-tenant"]) {
    const sources = `${treeItem}\n${runtimeHost}`;
    assert.ok(sources.includes(`node.type === "${nodeType}"`) || sources.includes(`node.type === '${nodeType}'`), nodeType);
  }
  assert.match(treeItem, /@dblclick="onDoubleClick"/);
  assert.match(treeItem, /@keydown="onKeydown"/);
  assert.match(treeItem, /@mousedown="onRowMouseDown"/);
  assert.match(treeItem, /@contextmenu="onTreeItemContextMenu"/);
});

test("plain tree sticky headers position the full row wrapper without a divider", () => {
  assert.match(treeItem, /<div v-else :class="\{ 'sidebar-tree-item--sticky': stickyHeader \}" @contextmenu="onTreeItemContextMenu">/);
  assert.doesNotMatch(treeItem, /'tree-item-highlight': highlighted,\s*'sidebar-tree-item--sticky': stickyHeader/);
  assert.match(treeItem, /\.sidebar-tree-item--sticky\s*\{[\s\S]*?position:\s*sticky;/);
  assert.match(treeItem, /\.sidebar-tree-item--sticky\s*\{[\s\S]*?background-color:\s*var\(--sidebar\);/);
  assert.doesNotMatch(treeItem, /\.sidebar-tree-item--sticky\s*\{[^}]*border-bottom:/);
  assert.doesNotMatch(connectionTree, /sticky-database-header[^\n]*border-b/);
  assert.match(connectionTree, /\.sticky-database-header\s*\{[\s\S]*?background-color:\s*var\(--sidebar\);/);
  assert.match(connectionTree, /v-for="\(item, index\) in flatNodes"/);
  assert.match(connectionTree, /:sticky-header="isPlainStickyContainerNode\(index\)"/);
  assert.match(connectionTree, /return flatTreeIndex\.value\.stickyContainerIndexByIndex\[index\] === index;/);
});

test("complex tree changes retain the full rebuild fallback", () => {
  assert.match(connectionTree, /const filteredNodes = computed/);
  assert.match(connectionTree, /filterSidebarTree\(/);
  assert.match(connectionTree, /const flatNodes = computed<FlatTreeNode\[]>/);
  // Virtual folders project the filtered physical objects at the final display
  // layer. Every change still rebuilds the complete flattened tree; injecting
  // synthetic folders before filtering would disrupt metadata/search scopes.
  assert.match(connectionTree, /flattenTree\(applySidebarVirtualGroups\(filteredNodes\.value,/);
  const filteredNodes = connectionTree.match(/const filteredNodes = computed\(\(\) => \{[\s\S]*?\n\}\);/)?.[0];
  assert.ok(filteredNodes);
  assert.doesNotMatch(filteredNodes, /applySidebarVirtualGroups/);
  assert.match(connectionTree, /watch\(flatNodes,/);
  assert.doesNotMatch(connectionTree, /treeScrollerRef\.value\?\.(?:forceUpdate|updateVisibleItems)/);
  assert.match(connectionTree, /@node-toggled="onNodeToggled"/);
});

test("tree toggles synchronize filtered node clones with the live sidebar tree", () => {
  const expandedConnection: TreeNode = {
    id: "connection-1",
    label: "Connection 1",
    type: "connection",
    connectionId: "connection-1",
    isExpanded: true,
  };
  const collapsedClone: TreeNode = { ...expandedConnection, isExpanded: false };
  const collapsedConnection: TreeNode = {
    id: "connection-2",
    label: "Connection 2",
    type: "connection",
    connectionId: "connection-2",
    isExpanded: false,
  };
  const expandedClone: TreeNode = { ...collapsedConnection, isExpanded: true };

  assert.equal(syncSidebarTreeNodeExpansion([expandedConnection], collapsedClone, false), true);
  assert.equal(expandedConnection.isExpanded, false);
  assert.equal(syncSidebarTreeNodeExpansion([collapsedConnection], expandedClone, true), true);
  assert.equal(collapsedConnection.isExpanded, true);
  assert.equal(syncSidebarTreeNodeExpansion([expandedConnection], expandedConnection, true), false);
});

test("async tree expansion does not restore a stale rendered clone state", () => {
  const liveDatabase: TreeNode = {
    id: "connection-1:database-1",
    label: "Database 1",
    type: "database",
    connectionId: "connection-1",
    database: "database-1",
    isExpanded: false,
    children: [],
  };
  const staleRenderedClone: TreeNode = { ...liveDatabase, children: [] };

  liveDatabase.isExpanded = true;

  assert.equal(syncSidebarTreeNodeExpansion([liveDatabase], staleRenderedClone, true), false);
  assert.equal(liveDatabase.isExpanded, true);
});

test("tree filters retain a temporary expansion state", () => {
  assert.match(connectionTree, /return \{ \.\.\.node, children: matchingChildren \};/);
  assert.doesNotMatch(connectionTree, /children: matchingChildren,\s*isExpanded:\s*true/);
  // Local object searches need the same temporary override for their virtual
  // folders, while ordinary physical nodes retain the global-search guard.
  assert.match(connectionTree, /const virtualFolderSearch = isSidebarVirtualGroupNode\(node\) && Object\.values\(store\.sidebarTableSearchQueries\)\.some\(\(query\) => !!query\?\.trim\(\)\);/);
  assert.match(connectionTree, /if \(\(!isTreeSearchFiltering\.value && !virtualFolderSearch\) \|\| !node\.children\) return;/);
  assert.match(connectionTree, /function onSearchToggle\(node: TreeNode\) \{[\s\S]*?const next = new Set\(searchCollapsedIds\.value\);[\s\S]*?searchCollapsedIds\.value = next;/);
  assert.match(connectionTree, /applySidebarVirtualGroups\(filteredNodes\.value, \{[^\n]*collapsedNodeIds: searchCollapsedIds\.value/);
  // The search guard must stay the first thing in onNodeToggled (filter toggles
  // must never sync back to the live tree); side-effect-free diagnostics may be
  // interleaved before the sync call, so match the guard and the required sync
  // separately instead of pinning the exact body.
  assert.match(connectionTree, /function onNodeToggled\(node: TreeNode, expanded: boolean\) \{\s*if \(isTreeSearchFiltering\.value\) return;[\s\S]*?syncSidebarTreeNodeExpansion\(store\.treeNodes, node, expanded\)/);
  assert.match(runtimeHost, /shouldRunTreeNodeRowAction\(action, clickDetail, isGroupLabel\(node\) \|\| isRepeatableNavigationTreeNode\(node\.type\)\)/);
});

test("tree rebuilds keep a context menu only while its target row remains visible", () => {
  assert.match(connectionTree, /nodes\.find\(\(\{ node \}\) => matchesSidebarActionTarget\(node, contextMenuTarget\)\)\?\.node/);
  assert.match(connectionTree, /if \(!visibleContextMenuTarget \|\| visibleContextMenuTarget\.valid === false\)/);
});

test("programmable object groups use the shared metadata loader", () => {
  assert.match(runtimeHost, /const databaseObjectGroup = !!objectTypesForGroupNode\(node\.type\)/);
  assert.match(connectionStore, /else if \(objectTypesForGroupNode\(node\.type\)\) \{\s*await loadObjectGroupChildren\(node, options\);/);
});
