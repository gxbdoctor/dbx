import { readFileSync } from "node:fs";
import ts from "typescript";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryTab, TreeNode } from "@/types/database";
import { flattenTree } from "@/composables/useFlatTree";
import { activeTabSidebarTarget, findNodePathForTarget, findSidebarNodeForTarget } from "@/lib/sidebar/sidebarActiveTabTarget";
import { applySidebarVirtualGroups, createSidebarVirtualGroup, expandSidebarVirtualGroupsForObject, isSidebarVirtualGroupNode, moveSidebarObjectToVirtualGroup, resetSidebarVirtualGroupsForTests, setSidebarVirtualGroupExpanded, sidebarVirtualGroupInfo } from "@/lib/sidebar/sidebarVirtualGroups";

const connectionTreeSource = readFileSync(new URL("../ConnectionTree.vue", import.meta.url), "utf8");

// Run the real locate handler with its narrow dependencies. Mounting the entire
// sidebar would also initialize unrelated desktop dialogs and backend runtimes.
function locateHandler(dependencies: Record<string, unknown>): (tab: QueryTab) => Promise<void> {
  const script = connectionTreeSource.split('<script setup lang="ts">')[1]!.split("</script>")[0]!;
  const source = ts.createSourceFile("ConnectionTree.ts", script, ts.ScriptTarget.Latest, true);
  const handler = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "locateTabInSidebar");
  if (!handler) throw new Error("ConnectionTree locate handler is missing");
  const compiled = ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn locateTabInSidebar;`)(...Object.values(dependencies));
}

afterEach(() => vi.unstubAllGlobals());

describe("ConnectionTree locate in collapsed groups", () => {
  it("reopens collapsed connection groups on the node path through the persisted layout op", () => {
    // Group expansion must flow through store.expandConnectionGroups so
    // layout.collapsed is flipped and the next layout rebuild keeps the group
    // open; flipping isExpanded directly would be reverted by that rebuild.
    expect(connectionTreeSource).toMatch(/const collapsedGroupIds = nodePath\s*\.filter\(\(node\) => node\.type === "connection-group" && !node\.isExpanded\)\s*\.map\(\(node\) => node\.id\);/);
    // The expansion happens before the flat-tree match that drives selection,
    // scrolling and flashing, so the reopened groups are visible to it.
    const expand = connectionTreeSource.indexOf("store.expandConnectionGroups(collapsedGroupIds);");
    const match = connectionTreeSource.indexOf("const match = target ? findSidebarNodeForTarget(target, flatNodes.value) : null;", expand);
    expect(expand).toBeGreaterThan(-1);
    expect(match).toBeGreaterThan(expand);
    expect(connectionTreeSource.slice(expand, match)).toContain("await nextTick();");
  });

  it("still gates generic ancestor expansion on loaded children only (#5850)", () => {
    expect(connectionTreeSource).toMatch(/if \(!ancestor\.isExpanded && store\.canUseLoadedTreeNodeToggle\(ancestor\)\) \{\s*ancestor\.isExpanded = true;\s*\}/);
  });

  it.each([false, true])("locates the real materialized view inside nested collapsed virtual folders (local search: %s)", async (localSearchActive) => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    resetSidebarVirtualGroupsForTests();
    const object: TreeNode = { id: "c:db:s:mv", type: "materialized_view", label: "mv", connectionId: "c", database: "db", schema: "s" };
    const parent: TreeNode = { id: "c:db:s:materialized-views", type: "group-materialized-views", label: "Materialized Views", connectionId: "c", database: "db", schema: "s", isExpanded: true, children: [object] };
    const connectionGroup: TreeNode = { id: "connections", type: "connection-group", label: "Connections", isExpanded: false, children: [parent] };
    const outer = createSidebarVirtualGroup(parent, "Research")!;
    const inner = createSidebarVirtualGroup(parent, "Sepsis", outer.id)!;
    const unrelated = createSidebarVirtualGroup(parent, "Unrelated")!;
    moveSidebarObjectToVirtualGroup(object, inner.id);
    for (const group of [outer, inner, unrelated]) setSidebarVirtualGroupExpanded(group.id, false);

    const store = {
      treeNodes: [connectionGroup],
      connectedIds: new Set(["c"]),
      getConfig: () => ({ db_type: "postgres" }),
      canUseLoadedTreeNodeToggle: (node: TreeNode) => node.type !== "connection-group" && !!node.children?.length,
      expandConnectionGroups: vi.fn(() => {
        connectionGroup.isExpanded = true;
      }),
      selectedTreeNodeId: null as string | null,
      selectedTreeNodeIds: [] as string[],
      treeSelectionAnchorId: null as string | null,
    };
    const tab = { id: "data-mv", mode: "data", connectionId: "c", database: "db", schema: "s", title: "mv" } as QueryTab;
    const target = activeTabSidebarTarget(tab)!;
    const projectedParent = applySidebarVirtualGroups([parent])[0]!;
    const unrelatedNode = projectedParent.children!.find((node) => node.label === unrelated.name)!;
    const ancestorIds = findNodePathForTarget(target, [projectedParent])!
      .filter(isSidebarVirtualGroupNode)
      .map((node) => node.id);
    const searchCollapsedIds = { value: new Set(localSearchActive ? [...ancestorIds, unrelatedNode.id] : []) };
    const flatNodes = {
      get value() {
        return flattenTree(applySidebarVirtualGroups(store.treeNodes, { forceExpanded: localSearchActive, collapsedNodeIds: searchCollapsedIds.value }));
      },
    };
    expect(findSidebarNodeForTarget(target, flatNodes.value)).toBeNull();
    const scrollToSidebarNode = vi.fn();
    const flashSidebarNode = vi.fn();
    const locate = locateHandler({
      activeTabSidebarTarget,
      store,
      nextTick,
      flatNodes,
      queryCursorTableCandidate: () => null,
      queryContextTargetFromCandidate: () => null,
      effectiveDatabaseTypeForConnection: () => "postgres",
      ensureTreeLoadedForTarget: vi.fn(),
      isRootListPartial: { value: false },
      resolveLoadedLocateTarget: () => target,
      findNodePathForTarget,
      findSidebarNodeForTarget,
      expandSidebarVirtualGroupsForObject,
      applySidebarVirtualGroups,
      isSidebarVirtualGroupNode,
      searchCollapsedIds,
      scrollToSidebarNode,
      flashSidebarNode,
    });

    await locate(tab);

    expect(store.expandConnectionGroups).toHaveBeenCalledWith([connectionGroup.id]);
    expect(sidebarVirtualGroupInfo(outer.id)?.group.expanded).toBe(true);
    expect(sidebarVirtualGroupInfo(inner.id)?.group.expanded).toBe(true);
    expect(sidebarVirtualGroupInfo(unrelated.id)?.group.expanded).toBe(false);
    expect([...searchCollapsedIds.value]).toEqual(localSearchActive ? [unrelatedNode.id] : []);
    expect(flatNodes.value.find((row) => row.id === unrelatedNode.id)?.node.isExpanded).toBe(false);
    expect(store.selectedTreeNodeId).toBe(object.id);
    expect(store.selectedTreeNodeIds).toEqual([object.id]);
    expect(store.treeSelectionAnchorId).toBe(object.id);
    expect(scrollToSidebarNode).toHaveBeenCalledWith(object.id, { align: "center" });
    expect(flashSidebarNode).toHaveBeenCalledWith(object.id);
    expect(parent.children).toEqual([object]);
  });
});
