// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "@/types/database";
import { applySidebarVirtualGroups, createSidebarVirtualGroup, moveSidebarObjectsToVirtualGroup, resetSidebarVirtualGroupsForTests, setSidebarVirtualGroupExpanded, sidebarVirtualGroupInfo, sidebarVirtualGroupsForObject } from "@/lib/sidebar/sidebarVirtualGroups";
import { createSidebarVirtualGroupDrag, resolveSidebarVirtualGroupDropTarget, sidebarVirtualGroupDragSource } from "@/lib/sidebar/sidebarVirtualGroupDrag";
import { activeTableReferencePayloadValue, createTableReferencePayload, DBX_TABLE_REFERENCE_DROP_EVENT } from "@/lib/editor/queryEditorTableDrop";

const object = (id: string, extra: Partial<TreeNode> = {}): TreeNode => ({ id, label: id, objectName: id, type: "materialized_view", connectionId: "connection-1", database: "db", catalog: "catalog", schema: "public", ...extra });
const root = (extra: Partial<TreeNode> = {}): TreeNode => ({ id: "root", label: "Materialized views", type: "group-materialized-views", connectionId: "connection-1", database: "db", catalog: "catalog", schema: "public", isExpanded: true, children: [object("first"), object("second")], ...extra });
const currentGroup = (node: TreeNode) => sidebarVirtualGroupsForObject(node).currentGroupId;
const projectedGroups = (parent: TreeNode) => applySidebarVirtualGroups([parent])[0]!.children!.filter((node) => node.type === "virtual-object-group");

function setup(parent = root()) {
  let hit: Element | null = null;
  const atPoint = vi.spyOn(document, "elementFromPoint").mockImplementation(() => hit);
  const onDragEnd = vi.fn();
  const onError = vi.fn();
  const expandNode = vi.fn((node: TreeNode) => {
    const groupId = node.id.split(":__dbx_virtual_group:")[1];
    if (groupId) setSidebarVirtualGroupExpanded(decodeURIComponent(groupId), true);
  });
  const controller = createSidebarVirtualGroupDrag({
    getVisibleNodes: () => [parent, ...projectedGroups(parent), ...parent.children!],
    expandNode,
    onDragEnd,
    onError,
  });
  const start = (node: TreeNode, selectedNodes: TreeNode[] = [node], referencePayload = createTableReferencePayload({ connectionId: node.connectionId, database: node.database, tableName: node.label })) => {
    const event = new MouseEvent("mousedown", { button: 0, buttons: 1, clientX: 10, clientY: 10, cancelable: true });
    controller.start(event, { node, selectedNodes, referencePayload, label: node.label });
    return event;
  };
  const pointTo = (node: TreeNode | string | null) => {
    if (!node) {
      hit = null;
      return null;
    }
    const row = document.createElement("div");
    if (typeof node === "string") row.setAttribute(node, "");
    else row.dataset.nodeId = node.id;
    const label = document.createElement("span");
    row.appendChild(label);
    document.body.appendChild(row);
    hit = label;
    return row;
  };
  const move = (x = 30, y = 30, buttons = 1) => document.dispatchEvent(new MouseEvent("mousemove", { buttons, clientX: x, clientY: y, cancelable: true }));
  const up = () => document.dispatchEvent(new MouseEvent("mouseup", { button: 0, clientX: 30, clientY: 30 }));
  return { controller, start, pointTo, move, up, onDragEnd, onError, expandNode, atPoint };
}

beforeEach(() => {
  resetSidebarVirtualGroupsForTests();
});
afterEach(() => {
  window.dispatchEvent(new Event("blur"));
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.style.cursor = "";
});

describe("sidebar virtual folder pointer dragging", () => {
  it("moves a single materialized view only on release and cleans up feedback", () => {
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    const node = parent.children![0]!;
    const drag = setup(parent);
    drag.start(node);
    const row = drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    expect(currentGroup(node)).toBeNull();
    expect(row!.dataset.virtualFolderDropTarget).toBe("true");
    expect(document.body.style.cursor).toBe("move");
    expect(document.querySelector("[data-table-reference-drag-chip]")).not.toBeNull();
    drag.up();
    expect(currentGroup(node)).toBe(group.id);
    expect(row!.dataset.virtualFolderDropTarget).toBeUndefined();
    expect(document.querySelector("[data-table-reference-drag-chip]")).toBeNull();
    expect(document.body.style.cursor).toBe("");
    expect(activeTableReferencePayloadValue()).toBeNull();
    expect(drag.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("moves the complete mouse-down selection even when it changes during dragging", () => {
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    const selected = [...parent.children!];
    const drag = setup(parent);
    drag.start(selected[0]!, selected);
    selected.splice(1);
    // Changing a source object's descriptor must also not change the snapshot.
    selected[0]!.schema = "changed-after-mousedown";
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    drag.up();
    expect(currentGroup(object("first"))).toBe(group.id);
    expect(currentGroup(object("second"))).toBe(group.id);
  });

  it("grabbing an unselected row moves only that row", () => {
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    const drag = setup(parent);
    drag.start(parent.children![0]!, [parent.children![1]!, object("third")]);
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    drag.up();
    expect(currentGroup(parent.children![0]!)).toBe(group.id);
    expect(currentGroup(parent.children![1]!)).toBeNull();
  });

  it("moves a selection back to its matching category root", () => {
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    moveSidebarObjectsToVirtualGroup(parent.children!, group.id);
    const drag = setup(parent);
    drag.start(parent.children![0]!, parent.children!);
    drag.pointTo(parent);
    drag.move();
    drag.up();
    expect(parent.children!.map(currentGroup)).toEqual([null, null]);
  });

  it.each(["connectionId", "database", "catalog", "schema"] as const)("rejects a mixed %s selection atomically", (field) => {
    const parent = root();
    createSidebarVirtualGroup(parent, "Reports");
    const first = parent.children![0]!;
    const second = object("second", { [field]: "other" });
    const drag = setup(parent);
    drag.start(first, [first, second]);
    const row = drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    drag.up();
    expect(row!.dataset.virtualFolderDropTarget).toBeUndefined();
    expect(currentGroup(first)).toBeNull();
    expect(currentGroup(second)).toBeNull();
  });

  it("rejects mixed object types without moving the matching subset", () => {
    const parent = root();
    createSidebarVirtualGroup(parent, "Reports");
    const first = parent.children![0]!;
    const drag = setup(parent);
    drag.start(first, [first, object("table", { type: "table" })]);
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    drag.up();
    expect(currentGroup(first)).toBeNull();
  });

  it.each(["connectionId", "database", "catalog", "schema", "type"] as const)("rejects removing an object on a different %s root", (field) => {
    const source = sidebarVirtualGroupDragSource(object("first"), [])!;
    const other = root({ [field]: field === "type" ? "group-tables" : "other" });
    expect(resolveSidebarVirtualGroupDropTarget(source, other)).toBeNull();
  });

  it("reparents a folder and rejects its own descendants and itself", () => {
    const parent = root();
    const first = createSidebarVirtualGroup(parent, "First")!;
    const second = createSidebarVirtualGroup(parent, "Second")!;
    const [firstNode, secondNode] = projectedGroups(parent);
    const drag = setup(parent);
    drag.start(firstNode!, [firstNode!], null);
    drag.pointTo(secondNode!);
    drag.move();
    drag.up();
    expect(sidebarVirtualGroupInfo(first.id)!.group.parentId).toBe(second.id);
    const source = sidebarVirtualGroupDragSource(secondNode!, [])!;
    expect(resolveSidebarVirtualGroupDropTarget(source, firstNode!)).toBeNull();
    expect(resolveSidebarVirtualGroupDropTarget(source, secondNode!)).toBeNull();
    expect(resolveSidebarVirtualGroupDropTarget(source, root({ database: "other" }))).toBeNull();
    // A nested folder can be returned to the category root.
    drag.start(firstNode!, [firstNode!], null);
    drag.pointTo(parent);
    drag.move();
    drag.up();
    expect(sidebarVirtualGroupInfo(first.id)!.group.parentId).toBeNull();
  });

  it.each(["escape", "blur", "lost-release", "explicit-cancel"])("cancels on %s without persisting a move", (reason) => {
    const parent = root();
    createSidebarVirtualGroup(parent, "Reports");
    const node = parent.children![0]!;
    const drag = setup(parent);
    document.body.style.cursor = "crosshair";
    drag.start(node);
    const row = drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    if (reason === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    if (reason === "blur") window.dispatchEvent(new Event("blur"));
    if (reason === "lost-release") drag.move(31, 31, 0);
    if (reason === "explicit-cancel") drag.controller.cancel();
    drag.up();
    drag.move();
    drag.up();
    expect(currentGroup(node)).toBeNull();
    expect(row!.dataset.virtualFolderDropTarget).toBeUndefined();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.querySelector("[data-table-reference-drag-chip]")).toBeNull();
    expect(activeTableReferencePayloadValue()).toBeNull();
    expect(drag.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("keeps clicks below the movement threshold as ordinary clicks", () => {
    const parent = root();
    createSidebarVirtualGroup(parent, "Reports");
    const drag = setup(parent);
    drag.start(parent.children![0]!);
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move(13, 12);
    drag.up();
    expect(currentGroup(parent.children![0]!)).toBeNull();
    expect(drag.onDragEnd).not.toHaveBeenCalled();
  });

  it("does nothing on a blank drop and cancels the hover expansion timer", () => {
    vi.useFakeTimers();
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    setSidebarVirtualGroupExpanded(group.id, false);
    const drag = setup(parent);
    drag.start(parent.children![0]!);
    const row = drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    vi.advanceTimersByTime(400);
    drag.pointTo(null);
    drag.move();
    vi.advanceTimersByTime(700);
    drag.up();
    expect(drag.expandNode).not.toHaveBeenCalled();
    expect(row!.dataset.virtualFolderDropTarget).toBeUndefined();
    expect(currentGroup(parent.children![0]!)).toBeNull();
  });

  it("expands a valid collapsed folder after hovering without moving objects", () => {
    vi.useFakeTimers();
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    setSidebarVirtualGroupExpanded(group.id, false);
    const drag = setup(parent);
    drag.start(parent.children![0]!);
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    vi.advanceTimersByTime(649);
    expect(drag.expandNode).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(drag.expandNode).toHaveBeenCalledTimes(1);
    expect(sidebarVirtualGroupInfo(group.id)!.group.expanded).toBe(true);
    expect(currentGroup(parent.children![0]!)).toBeNull();
    drag.controller.cancel();
  });

  it("finishes an active snapshot after its virtualized source row is recycled", () => {
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    const drag = setup(parent);
    drag.start(parent.children![0]!);
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    drag.controller.releaseSource();
    drag.up();
    expect(currentGroup(parent.children![0]!)).toBe(group.id);
    // Do not leak click suppression into the source row's replacement node.
    expect(drag.onDragEnd).not.toHaveBeenCalled();
    expect(document.querySelector("[data-table-reference-drag-chip]")).toBeNull();
  });

  it("cancels an older detached gesture before starting another row drag", () => {
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    const firstDrag = setup(parent);
    firstDrag.start(parent.children![0]!);
    firstDrag.pointTo(projectedGroups(parent)[0]!);
    firstDrag.move();
    firstDrag.controller.releaseSource();
    const secondDrag = setup(parent);
    secondDrag.start(parent.children![1]!);
    secondDrag.pointTo(projectedGroups(parent)[0]!);
    secondDrag.move();
    secondDrag.up();
    expect(currentGroup(parent.children![0]!)).toBeNull();
    expect(currentGroup(parent.children![1]!)).toBe(group.id);
    expect(document.querySelector("[data-table-reference-drag-chip]")).toBeNull();
  });

  it("discards an unstarted gesture when its source row is recycled", () => {
    const parent = root();
    createSidebarVirtualGroup(parent, "Reports");
    const drag = setup(parent);
    drag.start(parent.children![0]!);
    drag.controller.releaseSource();
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    drag.up();
    expect(currentGroup(parent.children![0]!)).toBeNull();
    expect(drag.onDragEnd).not.toHaveBeenCalled();
  });

  it("consumes the synthesized click on a different target row after a move", () => {
    const parent = root();
    createSidebarVirtualGroup(parent, "Reports");
    const drag = setup(parent);
    drag.start(parent.children![0]!);
    const row = drag.pointTo(projectedGroups(parent)[0]!)!;
    const onClick = vi.fn();
    row.addEventListener("click", onClick);
    drag.move();
    drag.up();
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).not.toHaveBeenCalled();
    // Subsequent deliberate clicks are ordinary clicks again.
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("reports persistence failure but treats an unchanged folder as a successful no-op", () => {
    const parent = root();
    const group = createSidebarVirtualGroup(parent, "Reports")!;
    moveSidebarObjectsToVirtualGroup([parent.children![1]!], group.id);
    const drag = setup(parent);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage full");
    });
    drag.start(parent.children![0]!);
    drag.pointTo(projectedGroups(parent)[0]!);
    drag.move();
    drag.up();
    expect(currentGroup(parent.children![0]!)).toBeNull();
    expect(drag.onError).toHaveBeenCalledTimes(1);
    expect(drag.onError.mock.calls[0]![0]).toContain("无法保存");
    drag.start(parent.children![1]!);
    drag.move();
    drag.up();
    expect(currentGroup(parent.children![1]!)).toBe(group.id);
    expect(drag.onError).toHaveBeenCalledTimes(1);
  });

  it.each(["data-query-editor-root", "data-ai-assistant-root"])("preserves existing reference drops into %s", (targetAttribute) => {
    const parent = root();
    const node = parent.children![0]!;
    const drag = setup(parent);
    const received: unknown[] = [];
    const listener = (event: Event) => received.push((event as CustomEvent).detail);
    window.addEventListener(DBX_TABLE_REFERENCE_DROP_EVENT, listener);
    try {
      const payload = createTableReferencePayload({ connectionId: node.connectionId, database: node.database, tableName: node.label })!;
      drag.start(node, [node], payload);
      drag.pointTo(targetAttribute);
      drag.move();
      expect(document.body.style.cursor).toBe("copy");
      drag.up();
      expect(received).toEqual([{ payload, clientX: 30, clientY: 30 }]);
      expect(currentGroup(node)).toBeNull();
      expect(activeTableReferencePayloadValue()).toBeNull();
    } finally {
      window.removeEventListener(DBX_TABLE_REFERENCE_DROP_EVENT, listener);
    }
  });
});
