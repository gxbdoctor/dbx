import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "@/types/database";
import {
  applySidebarVirtualGroups,
  canMoveSidebarObjectsToVirtualGroup,
  canMoveSidebarVirtualGroup,
  createSidebarVirtualGroup,
  createSidebarVirtualGroupWithObjects,
  deleteSidebarVirtualGroup,
  exportSidebarVirtualGroups,
  expandSidebarVirtualGroupsForObject,
  importSidebarVirtualGroups,
  moveSidebarObjectToVirtualGroup,
  moveSidebarObjectsToVirtualGroup,
  moveSidebarVirtualGroup,
  renameSidebarVirtualGroup,
  reorderSidebarVirtualGroup,
  resetSidebarVirtualGroupsForTests,
  setSidebarVirtualGroupExpanded,
  setSidebarVirtualGroupsExpanded,
  sidebarVirtualGroupInfo,
  sidebarVirtualGroupObjectKey,
  sidebarVirtualGroupPath,
  sidebarVirtualGroupsCanUndo,
  sidebarVirtualGroupsForObject,
  sidebarVirtualGroupsForParent,
  sidebarVirtualGroupsPersistenceError,
  sidebarVirtualGroupsRevision,
  undoSidebarVirtualGroups,
} from "@/lib/sidebar/sidebarVirtualGroups";

const storage = new Map<string, string>();
const storageKey = "dbx-sidebar-virtual-groups-v1";

function matView(name: string): TreeNode {
  return {
    id: `c:db:s:__materialized_views:s:${name}`,
    label: name,
    type: "materialized_view",
    connectionId: "c",
    database: "db",
    schema: "s",
    children: [],
  };
}

function parent(children: TreeNode[]): TreeNode {
  return {
    id: "c:db:s:__materialized_views",
    label: "Materialized Views",
    type: "group-materialized-views",
    connectionId: "c",
    database: "db",
    schema: "s",
    isExpanded: true,
    children,
  };
}

describe("sidebar virtual groups", () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
    resetSidebarVirtualGroupsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("projects assigned materialized views into a local folder without changing object identity", () => {
    const a = matView("sdic_lab");
    const b = matView("aki_48h");
    const source = parent([a, b]);
    const group = createSidebarVirtualGroup(source, "DIC / SIC");
    expect(group).not.toBeNull();
    expect(moveSidebarObjectToVirtualGroup(a, group!.id)).toBe(true);

    const projectedParent = applySidebarVirtualGroups([source])[0];
    const folder = projectedParent.children?.[0];
    expect(folder?.type).toBe("virtual-object-group");
    expect(folder?.label).toBe("DIC / SIC");
    expect(folder?.children?.map((node) => node.label)).toEqual(["sdic_lab"]);
    expect(folder?.children?.[0].id).toBe(a.id);
    expect(projectedParent.children?.map((node) => node.label)).toContain("aki_48h");
  });

  it("renames, ungroups and deletes folders without touching database objects", () => {
    const a = matView("sdic_lab");
    const source = parent([a]);
    const group = createSidebarVirtualGroup(source, "DIC")!;
    moveSidebarObjectToVirtualGroup(a, group.id);
    expect(renameSidebarVirtualGroup(group.id, "Coagulation")).toBe(true);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(group.id);
    expect(moveSidebarObjectToVirtualGroup(a, null)).toBe(true);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBeNull();
    expect(deleteSidebarVirtualGroup(group.id)).toBe(true);
    expect(applySidebarVirtualGroups([source])[0].children?.[0].id).toBe(a.id);
  });

  it("projects empty and nested folders even before objects are loaded", () => {
    const source = parent([]);
    const root = createSidebarVirtualGroup(source, "Projects")!;
    const nested = createSidebarVirtualGroup(source, "ARDS", root.id)!;
    expect(sidebarVirtualGroupPath(nested.id)).toBe("Projects / ARDS");
    expect(sidebarVirtualGroupInfo(nested.id)?.parent.type).toBe("group-materialized-views");
    for (const children of [[], undefined]) {
      const projected = applySidebarVirtualGroups([{ ...source, children }])[0];
      expect(projected.children?.map((node) => node.label)).toEqual(["Projects"]);
      expect(projected.children?.[0].children?.[0]).toMatchObject({ label: "ARDS", objectCount: 0, children: [] });
    }
  });

  it("allows repeated names in different folders but rejects sibling collisions", () => {
    const source = parent([]);
    const first = createSidebarVirtualGroup(source, "One")!;
    const second = createSidebarVirtualGroup(source, "Two")!;
    expect(createSidebarVirtualGroup(source, " one ")).toBeNull();
    const child = createSidebarVirtualGroup(source, "Shared", first.id)!;
    expect(createSidebarVirtualGroup(source, "Shared", second.id)).not.toBeNull();
    expect(createSidebarVirtualGroup(source, "shared", first.id)).toBeNull();
    const other = createSidebarVirtualGroup(source, "Other", first.id)!;
    expect(renameSidebarVirtualGroup(other.id, "SHARED")).toBe(false);
    expect(renameSidebarVirtualGroup(child.id, " Two ")).toBe(true);
    expect(sidebarVirtualGroupInfo(child.id)?.group.name).toBe("Two");
    expect(createSidebarVirtualGroup(source, "Orphan", "missing")).toBeNull();
  });

  it("preserves spaces and explicit database object names in membership keys", () => {
    const a = { ...matView("same"), objectName: " same " };
    const b = matView("same");
    const source = parent([a, b]);
    const folder = createSidebarVirtualGroup(source, "Names")!;
    expect(sidebarVirtualGroupObjectKey(a)).not.toBe(sidebarVirtualGroupObjectKey(b));
    expect(moveSidebarObjectToVirtualGroup(a, folder.id)).toBe(true);
    const projected = applySidebarVirtualGroups([source])[0];
    expect(projected.children?.[0].children?.[0].objectName).toBe(" same ");
    expect(projected.children?.[1].id).toBe(b.id);
    expect(sidebarVirtualGroupsForObject(b).currentGroupId).toBeNull();
  });

  it("moves a whole selection in one persisted operation and treats repeated items as one", () => {
    const a = matView("a");
    const b = matView("b");
    const source = parent([a, b]);
    const folder = createSidebarVirtualGroup(source, "Batch")!;
    const revision = sidebarVirtualGroupsRevision.value;
    vi.mocked(localStorage.setItem).mockClear();
    expect(moveSidebarObjectsToVirtualGroup([a, b, a], folder.id)).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(sidebarVirtualGroupsRevision.value).toBe(revision + 1);
    expect(sidebarVirtualGroupInfo(folder.id)?.group.members).toHaveLength(2);
    expect(moveSidebarObjectsToVirtualGroup([a, b], folder.id)).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(undoSidebarVirtualGroups()).toBe(true);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBeNull();
    expect(sidebarVirtualGroupsForObject(b).currentGroupId).toBeNull();
  });

  it("creates and fills a folder atomically, undoing both creation and assignment together", () => {
    const a = matView("a");
    const b = matView("b");
    const source = parent([a, b]);
    const previous = createSidebarVirtualGroup(source, "Previous")!;
    moveSidebarObjectToVirtualGroup(a, previous.id);
    vi.mocked(localStorage.setItem).mockClear();
    const created = createSidebarVirtualGroupWithObjects(source, "Batch", [a, b])!;
    expect(created).not.toBeNull();
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(created.id);
    expect(sidebarVirtualGroupsForObject(b).currentGroupId).toBe(created.id);
    expect(undoSidebarVirtualGroups()).toBe(true);
    expect(sidebarVirtualGroupInfo(created.id)).toBeNull();
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(previous.id);
    expect(sidebarVirtualGroupsForObject(b).currentGroupId).toBeNull();
    const before = exportSidebarVirtualGroups();
    expect(createSidebarVirtualGroupWithObjects({ ...source, database: "foreign" }, "Invalid", [a])).toBeNull();
    expect(exportSidebarVirtualGroups()).toBe(before);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect(createSidebarVirtualGroupWithObjects(source, "Cannot save", [a, b])).toBeNull();
    expect(exportSidebarVirtualGroups()).toBe(before);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(previous.id);
  });

  it.each([{ connectionId: "another" }, { database: "another" }, { catalog: "another" }, { schema: "another" }, { type: "table" as const }, { type: "column" as const }])("rejects mixed-scope selections atomically: %j", (different) => {
    const a = matView("a");
    const source = parent([a]);
    const from = createSidebarVirtualGroup(source, "From")!;
    const to = createSidebarVirtualGroup(source, "To")!;
    moveSidebarObjectToVirtualGroup(a, from.id);
    const snapshot = exportSidebarVirtualGroups();
    const nodes = [a, { ...matView("b"), ...different }];
    expect(canMoveSidebarObjectsToVirtualGroup(nodes, to.id)).toBe(false);
    expect(moveSidebarObjectsToVirtualGroup(nodes, to.id)).toBe(false);
    expect(moveSidebarObjectsToVirtualGroup(nodes, null)).toBe(false);
    expect(exportSidebarVirtualGroups()).toBe(snapshot);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(from.id);
  });

  it("rejects missing and foreign destination folders without removing existing assignments", () => {
    const a = matView("a");
    const source = parent([a]);
    const folder = createSidebarVirtualGroup(source, "Original")!;
    const foreign = createSidebarVirtualGroup({ ...source, connectionId: "other" }, "Foreign")!;
    moveSidebarObjectToVirtualGroup(a, folder.id);
    expect(moveSidebarObjectsToVirtualGroup([], folder.id)).toBe(false);
    expect(moveSidebarObjectToVirtualGroup(a, "missing")).toBe(false);
    expect(moveSidebarObjectToVirtualGroup(a, foreign.id)).toBe(false);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(folder.id);
  });

  it("moves folders with descendants but rejects cycles, foreign parents and duplicate siblings", () => {
    const source = parent([]);
    const first = createSidebarVirtualGroup(source, "First")!;
    const child = createSidebarVirtualGroup(source, "Child", first.id)!;
    const grandchild = createSidebarVirtualGroup(source, "Grandchild", child.id)!;
    const second = createSidebarVirtualGroup(source, "Second")!;
    const foreign = createSidebarVirtualGroup({ ...source, database: "other" }, "Foreign")!;
    expect(canMoveSidebarVirtualGroup(first.id, grandchild.id)).toBe(false);
    expect(moveSidebarVirtualGroup(first.id, child.id)).toBe(false);
    expect(moveSidebarVirtualGroup(first.id, first.id)).toBe(false);
    expect(moveSidebarVirtualGroup(first.id, foreign.id)).toBe(false);
    expect(moveSidebarVirtualGroup(child.id, second.id)).toBe(true);
    expect(sidebarVirtualGroupPath(grandchild.id)).toBe("Second / Child / Grandchild");
    createSidebarVirtualGroup(source, "Child", first.id);
    expect(moveSidebarVirtualGroup(child.id, first.id)).toBe(false);
    expect(moveSidebarVirtualGroup(child.id, null)).toBe(true);
    expect(sidebarVirtualGroupPath(grandchild.id)).toBe("Child / Grandchild");
  });

  it("dissolves descendant folders without losing real objects and supports a single undo", () => {
    const a = matView("a");
    const b = matView("b");
    const c = matView("c");
    const source = parent([a, b, c]);
    const root = createSidebarVirtualGroup(source, "Root")!;
    const nested = createSidebarVirtualGroup(source, "Nested", root.id)!;
    const keep = createSidebarVirtualGroup(source, "Keep")!;
    moveSidebarObjectToVirtualGroup(a, root.id);
    moveSidebarObjectToVirtualGroup(b, nested.id);
    moveSidebarObjectToVirtualGroup(c, keep.id);
    const alreadyProjected = applySidebarVirtualGroups([source]);
    expect(deleteSidebarVirtualGroup(root.id)).toBe(true);
    expect(sidebarVirtualGroupInfo(nested.id)).toBeNull();
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBeNull();
    expect(sidebarVirtualGroupsForObject(b).currentGroupId).toBeNull();
    expect(sidebarVirtualGroupsForObject(c).currentGroupId).toBe(keep.id);
    expect(applySidebarVirtualGroups(alreadyProjected)[0].children?.map((node) => node.label)).toEqual(["Keep", "b", "a"]);
    expect(undoSidebarVirtualGroups()).toBe(true);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(root.id);
    expect(sidebarVirtualGroupsForObject(b).currentGroupId).toBe(nested.id);
  });

  it("retains memberships across filtering and pagination and never nests duplicate projections", () => {
    const a = matView("a");
    const b = matView("b");
    const more: TreeNode = { id: "more", type: "load-more", label: "Load more", loadMore: { parentId: parent([]).id, offset: 1, pageSize: 1 } };
    const folder = createSidebarVirtualGroup(parent([]), "Paginated")!;
    moveSidebarObjectsToVirtualGroup([a, b], folder.id);
    const firstPage = applySidebarVirtualGroups([parent([a, more])]);
    expect(firstPage[0].children?.[0].children?.map((node) => node.label)).toEqual(["a"]);
    expect(firstPage[0].children?.[firstPage[0].children.length - 1]?.loadMore).toEqual(more.loadMore);
    expect(applySidebarVirtualGroups(firstPage)).toEqual(firstPage);
    expect(applySidebarVirtualGroups([parent([])])[0].children?.[0].children).toEqual([]);
    expect(sidebarVirtualGroupInfo(folder.id)?.group.members).toHaveLength(2);
    const laterPage = applySidebarVirtualGroups([parent([a, b])]);
    expect(laterPage[0].children?.[0].children?.map((node) => node.label)).toEqual(["a", "b"]);
    const filtered = structuredClone(laterPage);
    filtered[0].children![0].children = [b];
    expect(applySidebarVirtualGroups(filtered)[0].children?.[0].children?.map((node) => node.label)).toEqual(["b"]);
  });

  it("reorders only siblings and leaves child ownership intact", () => {
    const source = parent([]);
    const a = createSidebarVirtualGroup(source, "A")!;
    const child = createSidebarVirtualGroup(source, "Child", a.id)!;
    const b = createSidebarVirtualGroup(source, "B")!;
    expect(reorderSidebarVirtualGroup(b.id, "up")).toBe(true);
    expect(applySidebarVirtualGroups([source])[0].children?.map((node) => node.label)).toEqual(["B", "A"]);
    expect(sidebarVirtualGroupInfo(child.id)?.group.parentId).toBe(a.id);
    expect(reorderSidebarVirtualGroup(b.id, "up")).toBe(false);
    expect(reorderSidebarVirtualGroup(child.id, "down")).toBe(false);
  });

  it("round-trips nested backups and migrates the original flat version 1 format", () => {
    const a = matView("a");
    const source = parent([a]);
    const root = createSidebarVirtualGroup(source, "Root")!;
    const nested = createSidebarVirtualGroup(source, "Nested", root.id)!;
    moveSidebarObjectToVirtualGroup(a, nested.id);
    const backup = exportSidebarVirtualGroups();
    deleteSidebarVirtualGroup(root.id);
    expect(importSidebarVirtualGroups(backup)).toEqual({ success: true });
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(nested.id);
    expect(sidebarVirtualGroupPath(nested.id)).toBe("Root / Nested");

    const legacy = { version: 1, scopes: { [JSON.stringify(["c", "db", "", "s", "group-materialized-views"])]: [{ id: "legacy", name: "Old folder", expanded: false, members: [sidebarVirtualGroupObjectKey(a)] }] } };
    expect(importSidebarVirtualGroups(JSON.stringify(legacy))).toEqual({ success: true });
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe("legacy");
    expect(sidebarVirtualGroupInfo("legacy")?.group).toMatchObject({ parentId: null, expanded: false });
    expect(JSON.parse(exportSidebarVirtualGroups()).version).toBe(2);
    expect(undoSidebarVirtualGroups()).toBe(true);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(nested.id);
  });

  it.each(["not JSON", JSON.stringify({ version: 3, scopes: {} }), JSON.stringify({ version: 2, scopes: [] }), JSON.stringify({ version: 2, scopes: { bad: [] } })])("preserves existing data on a malformed import: %s", (invalid) => {
    createSidebarVirtualGroup(parent([]), "Keep me");
    const before = exportSidebarVirtualGroups();
    const persisted = storage.get(storageKey);
    const revision = sidebarVirtualGroupsRevision.value;
    expect(importSidebarVirtualGroups(invalid).success).toBe(false);
    expect(exportSidebarVirtualGroups()).toBe(before);
    expect(storage.get(storageKey)).toBe(persisted);
    expect(sidebarVirtualGroupsRevision.value).toBe(revision);
  });

  it.each(["cycle", "orphan", "duplicate-id", "duplicate-name", "duplicate-member", "wrong-scope-member", "invalid-expanded", "invalid-members"])("rejects invalid backup relationships transactionally: %s", (problem) => {
    const source = parent([]);
    const a = createSidebarVirtualGroup(source, "A")!;
    createSidebarVirtualGroup(source, "B", a.id);
    moveSidebarObjectToVirtualGroup(matView("a"), a.id);
    const before = exportSidebarVirtualGroups();
    const invalid = JSON.parse(before);
    const [scope] = Object.keys(invalid.scopes);
    const groups = invalid.scopes[scope];
    if (problem === "cycle") groups[0].parentId = groups[1].id;
    if (problem === "orphan") groups[1].parentId = "missing";
    if (problem === "duplicate-id") groups[1].id = groups[0].id;
    if (problem === "duplicate-name") {
      groups[1].parentId = null;
      groups[1].name = "a";
    }
    if (problem === "duplicate-member") groups[1].members = [...groups[0].members];
    if (problem === "wrong-scope-member") groups[0].members = [JSON.stringify(["table", "", "s", "a"])];
    if (problem === "invalid-expanded") groups[0].expanded = "yes";
    if (problem === "invalid-members") groups[0].members = [null];
    expect(importSidebarVirtualGroups(JSON.stringify(invalid)).success).toBe(false);
    expect(exportSidebarVirtualGroups()).toBe(before);
  });

  it("reports failed writes, leaves state and undo intact, and permits retry", () => {
    const a = matView("a");
    const source = parent([a]);
    const folder = createSidebarVirtualGroup(source, "Keep")!;
    const before = exportSidebarVirtualGroups();
    const revision = sidebarVirtualGroupsRevision.value;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect(moveSidebarObjectToVirtualGroup(a, folder.id)).toBe(false);
    expect(createSidebarVirtualGroup(source, "Cannot save")).toBeNull();
    expect(deleteSidebarVirtualGroup(folder.id)).toBe(false);
    expect(importSidebarVirtualGroups(JSON.stringify({ version: 2, scopes: {} })).success).toBe(false);
    expect(undoSidebarVirtualGroups()).toBe(false);
    expect(sidebarVirtualGroupsPersistenceError.value).toBeTruthy();
    expect(sidebarVirtualGroupsRevision.value).toBe(revision);
    expect(exportSidebarVirtualGroups()).toBe(before);
    expect(sidebarVirtualGroupsCanUndo.value).toBe(true);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => storage.set(key, value));
    expect(moveSidebarObjectToVirtualGroup(a, folder.id)).toBe(true);
    expect(sidebarVirtualGroupsPersistenceError.value).toBeNull();
    expect(undoSidebarVirtualGroups()).toBe(true);
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBeNull();
  });

  it("does not fill operation undo history with expand/collapse gestures", () => {
    const source = parent([]);
    const folder = createSidebarVirtualGroup(source, "Folder")!;
    expect(setSidebarVirtualGroupExpanded(folder.id, false)).toBe(true);
    expect(setSidebarVirtualGroupExpanded(folder.id, true)).toBe(true);
    expect(undoSidebarVirtualGroups()).toBe(true);
    expect(sidebarVirtualGroupsForParent(source)).toEqual([]);
    expect(sidebarVirtualGroupsCanUndo.value).toBe(false);
  });

  it("expands a filtered projection without changing saved folder expansion", () => {
    const source = parent([matView("match")]);
    const root = createSidebarVirtualGroup(source, "Root")!;
    const nested = createSidebarVirtualGroupWithObjects(source, "Nested", source.children!, root.id)!;
    setSidebarVirtualGroupsExpanded(source, false);
    const before = exportSidebarVirtualGroups();
    const filtered = applySidebarVirtualGroups([source], { forceExpanded: true });
    expect(filtered[0].children?.[0].isExpanded).toBe(true);
    expect(filtered[0].children?.[0].children?.[0].isExpanded).toBe(true);
    const collapsedNodeIds = new Set([filtered[0].children![0].children![0].id]);
    const manuallyCollapsed = applySidebarVirtualGroups([source], { forceExpanded: true, collapsedNodeIds });
    expect(manuallyCollapsed[0].children?.[0].isExpanded).toBe(true);
    expect(manuallyCollapsed[0].children?.[0].children?.[0].isExpanded).toBe(false);
    expect(sidebarVirtualGroupInfo(nested.id)?.group.expanded).toBe(false);
    expect(exportSidebarVirtualGroups()).toBe(before);
    expect(applySidebarVirtualGroups([source])[0].children?.[0].isExpanded).toBe(false);
  });

  it("reveals a located object by expanding only its ancestor path with one write", () => {
    const a = matView("a");
    const source = parent([a]);
    const root = createSidebarVirtualGroup(source, "Root")!;
    const nested = createSidebarVirtualGroupWithObjects(source, "Nested", [a], root.id)!;
    const unrelated = createSidebarVirtualGroup(source, "Unrelated")!;
    setSidebarVirtualGroupsExpanded(source, false);
    vi.mocked(localStorage.setItem).mockClear();
    expect(expandSidebarVirtualGroupsForObject(a)).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(sidebarVirtualGroupInfo(root.id)?.group.expanded).toBe(true);
    expect(sidebarVirtualGroupInfo(nested.id)?.group.expanded).toBe(true);
    expect(sidebarVirtualGroupInfo(unrelated.id)?.group.expanded).toBe(false);
    expect(expandSidebarVirtualGroupsForObject(a)).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(undoSidebarVirtualGroups()).toBe(true);
    expect(sidebarVirtualGroupInfo(unrelated.id)).toBeNull();
    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(nested.id);
  });

  it("expands/collapses all folders with one write and ignores unchanged state", () => {
    const source = parent([]);
    const root = createSidebarVirtualGroup(source, "Root")!;
    createSidebarVirtualGroup(source, "Child", root.id);
    vi.mocked(localStorage.setItem).mockClear();
    expect(setSidebarVirtualGroupsExpanded(source, false)).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(sidebarVirtualGroupsForParent(source).every((group) => !group.expanded)).toBe(true);
    expect(setSidebarVirtualGroupsExpanded(source, false)).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("rejects overlong new names while preserving older names on import", () => {
    const source = parent([]);
    const folder = createSidebarVirtualGroup(source, "Normal")!;
    expect(createSidebarVirtualGroup(source, "x".repeat(121))).toBeNull();
    expect(renameSidebarVirtualGroup(folder.id, "x".repeat(121))).toBe(false);
    const old = JSON.parse(exportSidebarVirtualGroups());
    old.scopes[Object.keys(old.scopes)[0]][0].name = "x".repeat(121);
    expect(importSidebarVirtualGroups(JSON.stringify(old)).success).toBe(true);
    expect(sidebarVirtualGroupsForParent(source)[0].name).toHaveLength(121);
  });

  it("reads persisted version 1 folders on startup without rewriting the backup", async () => {
    const legacy = JSON.stringify({ version: 1, scopes: { [JSON.stringify(["c", "db", "", "s", "group-materialized-views"])]: [{ id: "legacy", name: "Legacy", members: [], expanded: true }] } });
    storage.set(storageKey, legacy);
    vi.mocked(localStorage.setItem).mockClear();
    vi.resetModules();
    const reloaded = await import("@/lib/sidebar/sidebarVirtualGroups");
    expect(reloaded.sidebarVirtualGroupsForParent(parent([]))[0]).toMatchObject({ id: "legacy", parentId: null });
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(storage.get(storageKey)).toBe(legacy);
  });

  it("surfaces malformed persisted data while preserving the original storage bytes", async () => {
    storage.set(storageKey, "broken backup");
    vi.mocked(localStorage.setItem).mockClear();
    vi.resetModules();
    const reloaded = await import("@/lib/sidebar/sidebarVirtualGroups");
    expect(reloaded.sidebarVirtualGroupsForParent(parent([]))).toEqual([]);
    expect(reloaded.sidebarVirtualGroupsLoadError.value).toBeTruthy();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(storage.get(storageKey)).toBe("broken backup");
    expect(reloaded.exportSidebarVirtualGroups()).toBe("broken backup");
    expect(reloaded.createSidebarVirtualGroup(parent([]), "Do not overwrite")).toBeNull();
    expect(storage.get(storageKey)).toBe("broken backup");
    expect(reloaded.sidebarVirtualGroupsPersistenceError.value).toBeTruthy();
    expect(reloaded.importSidebarVirtualGroups(JSON.stringify({ version: 2, scopes: {} })).success).toBe(true);
    expect(reloaded.sidebarVirtualGroupsLoadError.value).toBeNull();
    expect(reloaded.createSidebarVirtualGroup(parent([]), "Recovered")).not.toBeNull();
  });
});
