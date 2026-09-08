import type { TreeNode } from "@/types/database";
import {
  canMoveSidebarObjectsToVirtualGroup,
  canMoveSidebarVirtualGroup,
  isSidebarVirtualGroupNode,
  moveSidebarObjectsToVirtualGroup,
  moveSidebarVirtualGroup,
  sidebarVirtualGroupIdFromNode,
  sidebarVirtualGroupInfo,
  sidebarVirtualGroupParentTypeForObject,
  sidebarVirtualGroupsForObject,
  sidebarVirtualGroupsPersistenceError,
  supportsSidebarVirtualGroups,
} from "@/lib/sidebar/sidebarVirtualGroups";
import { clearActiveTableReferencePayload, createTableReferenceDragEndEvent, createTableReferenceDropEvent, createTableReferenceHoverEvent, setActiveTableReferencePayload, type QueryEditorTableReferencePayload } from "@/lib/editor/queryEditorTableDrop";
import { AI_ASSISTANT_TABLE_DROP_ROOT_SELECTOR } from "@/lib/ai/aiTableReferenceDrop";
import { beginTableReferenceDragFeedback, isOverSqlEditorTarget, type TableReferenceDragFeedback } from "@/lib/editor/tableReferenceDragFeedback";

const DRAG_THRESHOLD = 5;
const EXPAND_DELAY_MS = 650;
const CURSOR_PROPERTY = "--dbx-sidebar-folder-drag-cursor";
const HIGHLIGHT_CLASSES = ["ring-1", "ring-primary/50", "bg-primary/10"];
let clearSynthesizedClick: (() => void) | null = null;
let cancelActiveGesture: (() => void) | null = null;

type Scope = Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">;
export type SidebarVirtualGroupDragSource = { kind: "objects"; nodes: TreeNode[] } | { kind: "group"; groupId: string };
export interface SidebarVirtualGroupDropTarget {
  node: TreeNode;
  groupId: string | null;
}

function sameScope(left: Scope, right: Scope): boolean {
  return left.type === right.type && left.connectionId === right.connectionId && left.database === right.database && (left.catalog ?? "") === (right.catalog ?? "") && (left.schema ?? "") === (right.schema ?? "");
}

/** Snapshot the full selection at mouse-down. Never silently move only the valid
 * subset of a mixed selection; the model validates all objects atomically. */
export function sidebarVirtualGroupDragSource(node: TreeNode, selectedNodes: readonly TreeNode[]): SidebarVirtualGroupDragSource | null {
  const nodes = selectedNodes.length > 1 && selectedNodes.some((selected) => selected.id === node.id) ? selectedNodes : [node];
  if (nodes.length === 1 && isSidebarVirtualGroupNode(node)) {
    return { kind: "group", groupId: sidebarVirtualGroupIdFromNode(node)! };
  }
  if (!sidebarVirtualGroupParentTypeForObject(node.type)) return null;
  return { kind: "objects", nodes: nodes.map((selected) => ({ ...selected })) };
}

/** Both hover and release use this validation, including the root's scope. */
export function resolveSidebarVirtualGroupDropTarget(source: SidebarVirtualGroupDragSource | null, node: TreeNode | undefined): SidebarVirtualGroupDropTarget | null {
  if (!source || !node) return null;
  let groupId: string | null = null;
  let parent: Scope;
  if (isSidebarVirtualGroupNode(node)) {
    groupId = sidebarVirtualGroupIdFromNode(node);
    const info = groupId ? sidebarVirtualGroupInfo(groupId) : null;
    if (!info) return null;
    parent = info.parent;
  } else if (supportsSidebarVirtualGroups(node)) {
    parent = node;
  } else {
    return null;
  }

  if (source.kind === "group") {
    const info = sidebarVirtualGroupInfo(source.groupId);
    if (!info || !sameScope(info.parent, parent) || !canMoveSidebarVirtualGroup(source.groupId, groupId)) return null;
  } else {
    const first = source.nodes[0];
    const parentType = first && sidebarVirtualGroupParentTypeForObject(first.type);
    if (!first || !parentType || !sameScope({ ...first, type: parentType }, parent)) return null;
    if (!canMoveSidebarObjectsToVirtualGroup(source.nodes, groupId)) return null;
  }
  return { node, groupId };
}

interface DragStart {
  node: TreeNode;
  selectedNodes: readonly TreeNode[];
  referencePayload: QueryEditorTableReferencePayload | null;
  label: string;
}

interface DragOptions {
  getVisibleNodes(): readonly TreeNode[];
  expandNode(node: TreeNode): void;
  onDragEnd(): void;
  onError?(message: string): void;
  document?: Document;
}

/** One pointer gesture serves sidebar moves and existing SQL / AI references.
 * No folder mutation occurs until a validated mouse-up. */
export function createSidebarVirtualGroupDrag(options: DragOptions) {
  let pending: { source: SidebarVirtualGroupDragSource | null; referencePayload: QueryEditorTableReferencePayload | null; label: string; startX: number; startY: number } | null = null;
  let active = false;
  let sourceAttached = true;
  let feedback: TableReferenceDragFeedback | null = null;
  let cursorStyle: HTMLStyleElement | null = null;
  let highlighted: HTMLElement | null = null;
  let highlightedId: string | null = null;
  let expandTimer: ReturnType<typeof setTimeout> | null = null;
  let previousCursor = "";
  const doc = options.document ?? document;
  const viewport = doc.defaultView ?? window;

  function clearHighlight() {
    if (expandTimer !== null) clearTimeout(expandTimer);
    expandTimer = null;
    if (highlighted) {
      highlighted.classList.remove(...HIGHLIGHT_CLASSES);
      delete highlighted.dataset.virtualFolderDropTarget;
    }
    highlighted = null;
    highlightedId = null;
  }

  function targetAt(event: MouseEvent) {
    const element = doc.elementFromPoint(event.clientX, event.clientY);
    const row = element?.closest<HTMLElement>("[data-node-id]") ?? null;
    const node = row ? options.getVisibleNodes().find((candidate) => candidate.id === row.dataset.nodeId) : undefined;
    return { element, row, target: resolveSidebarVirtualGroupDropTarget(pending?.source ?? null, node) };
  }

  function updateHighlight(row: HTMLElement | null, target: SidebarVirtualGroupDropTarget | null) {
    if (row === highlighted && target?.node.id === highlightedId) return;
    clearHighlight();
    if (!row || !target) return;
    highlighted = row;
    highlightedId = target.node.id;
    row.classList.add(...HIGHLIGHT_CLASSES);
    row.dataset.virtualFolderDropTarget = "true";
    if (!target.node.isExpanded) {
      const targetId = target.node.id;
      expandTimer = setTimeout(() => {
        expandTimer = null;
        // Re-fetch the node after tree refreshes or virtualization recycles rows.
        const current = options.getVisibleNodes().find((node) => node.id === targetId);
        if (active && current && !current.isExpanded && resolveSidebarVirtualGroupDropTarget(pending?.source ?? null, current)) options.expandNode(current);
      }, EXPAND_DELAY_MS);
    }
  }

  function finish() {
    if (!pending) return;
    if (cancelActiveGesture === finish) cancelActiveGesture = null;
    const wasActive = active;
    const payload = pending.referencePayload;
    pending = null;
    active = false;
    clearHighlight();
    feedback?.end();
    feedback = null;
    cursorStyle?.remove();
    cursorStyle = null;
    doc.body.style.removeProperty(CURSOR_PROPERTY);
    if (wasActive) {
      doc.body.style.cursor = previousCursor;
      if (payload) clearActiveTableReferencePayload(payload);
      viewport.dispatchEvent(createTableReferenceDragEndEvent());
      if (sourceAttached) options.onDragEnd();
    }
    doc.removeEventListener("mousemove", onMove, true);
    doc.removeEventListener("mouseup", onUp, true);
    doc.removeEventListener("keydown", onKeydown, true);
    viewport.removeEventListener("blur", finish);
  }

  function onMove(event: MouseEvent) {
    if (!pending) return;
    // Mouse-up outside the application may not be delivered to its document.
    if (!(event.buttons & 1)) {
      finish();
      return;
    }
    if (!active) {
      if (Math.abs(event.clientX - pending.startX) < DRAG_THRESHOLD && Math.abs(event.clientY - pending.startY) < DRAG_THRESHOLD) return;
      active = true;
      previousCursor = doc.body.style.cursor;
      if (pending.referencePayload) setActiveTableReferencePayload(pending.referencePayload);
      feedback = beginTableReferenceDragFeedback(pending.label, doc);
      // Tree rows and editor surfaces declare their own cursor. A temporary
      // rule lets drag feedback override those until this gesture ends.
      cursorStyle = doc.createElement("style");
      cursorStyle.dataset.sidebarFolderDragCursor = "";
      cursorStyle.textContent = `body.dbx-table-reference-dragging, body.dbx-table-reference-dragging * { cursor: var(${CURSOR_PROPERTY}, copy) !important; }`;
      doc.head.appendChild(cursorStyle);
    }
    event.preventDefault();
    doc.getSelection()?.removeAllRanges();
    feedback?.update(event.clientX, event.clientY);
    const { element, row, target } = targetAt(event);
    updateHighlight(row, target);
    const overReferenceTarget = !!pending.referencePayload && !!element?.closest(`[data-query-editor-root], ${AI_ASSISTANT_TABLE_DROP_ROOT_SELECTOR}`);
    doc.body.style.cursor = target ? "move" : overReferenceTarget ? "copy" : "not-allowed";
    doc.body.style.setProperty(CURSOR_PROPERTY, doc.body.style.cursor);
    if (pending.referencePayload && isOverSqlEditorTarget(event.clientX, event.clientY, doc)) {
      viewport.dispatchEvent(createTableReferenceHoverEvent({ clientX: event.clientX, clientY: event.clientY }));
    }
  }

  function onUp(event: MouseEvent) {
    if (!pending) return;
    // Capture the gesture before model mutation may synchronously recycle rows.
    const snapshot = pending;
    const wasActive = active;
    const { element, target } = wasActive ? targetAt(event) : { element: null, target: null };
    finish();
    if (!wasActive || event.button !== 0) return;
    // The browser's synthesized click can target a different/recycled row or
    // the common tree ancestor. Consume that click so a move never opens an
    // object, collapses its target folder, or clears the selection.
    clearSynthesizedClick?.();
    const consumeClick = (click: MouseEvent) => {
      click.preventDefault();
      click.stopImmediatePropagation();
      cleanupClick();
    };
    const cleanupClick = () => {
      doc.removeEventListener("click", consumeClick, true);
      clearTimeout(clickTimer);
      if (clearSynthesizedClick === cleanupClick) clearSynthesizedClick = null;
    };
    doc.addEventListener("click", consumeClick, true);
    const clickTimer = setTimeout(cleanupClick, 0);
    clearSynthesizedClick = cleanupClick;
    if (target && snapshot.source) {
      const source = snapshot.source;
      const noChange = source.kind === "group" ? (sidebarVirtualGroupInfo(source.groupId)?.group.parentId ?? null) === target.groupId : source.nodes.every((node) => sidebarVirtualGroupsForObject(node).currentGroupId === target.groupId);
      if (noChange) return;
      const moved = source.kind === "group" ? moveSidebarVirtualGroup(source.groupId, target.groupId) : moveSidebarObjectsToVirtualGroup(source.nodes, target.groupId);
      if (!moved) options.onError?.(sidebarVirtualGroupsPersistenceError.value ?? "无法移动到此虚拟文件夹，请检查目标后重试");
    } else if (snapshot.referencePayload && element?.closest(`[data-query-editor-root], ${AI_ASSISTANT_TABLE_DROP_ROOT_SELECTOR}`)) {
      viewport.dispatchEvent(createTableReferenceDropEvent({ payload: snapshot.referencePayload, clientX: event.clientX, clientY: event.clientY }));
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  }

  return {
    start(event: MouseEvent, input: DragStart): boolean {
      if (event.button !== 0) return false;
      cancelActiveGesture?.();
      finish();
      const source = sidebarVirtualGroupDragSource(input.node, input.selectedNodes);
      if (!source && !input.referencePayload) return false;
      event.preventDefault();
      doc.getSelection()?.removeAllRanges();
      sourceAttached = true;
      pending = { source, referencePayload: input.referencePayload, label: input.label, startX: event.clientX, startY: event.clientY };
      cancelActiveGesture = finish;
      doc.addEventListener("mousemove", onMove, true);
      doc.addEventListener("mouseup", onUp, true);
      doc.addEventListener("keydown", onKeydown, true);
      viewport.addEventListener("blur", finish);
      return true;
    },
    cancel: finish,
    // Virtualized rows are recycled during scrolling/hover expansion. The
    // active gesture owns a snapshot and window listeners, so it outlives its
    // source row; mouse-up, Escape, blur, or lost button state still cleans up.
    releaseSource() {
      if (active) sourceAttached = false;
      else finish();
    },
  };
}
