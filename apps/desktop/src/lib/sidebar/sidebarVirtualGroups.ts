import { ref } from "vue";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/backend/safeStorage";
import type { TreeNode, TreeNodeType } from "@/types/database";

// Keep the key so installing the plugin preserves folders created by earlier DBX builds.
const STORAGE_KEY = "dbx-sidebar-virtual-groups-v1";
const VIRTUAL_GROUP_ID_MARKER = ":__dbx_virtual_group:";
const MAX_UNDO = 30;
const MAX_FOLDER_NAME = 120;

export type SidebarVirtualGroupParentType = "group-tables" | "group-views" | "group-materialized-views";
export type SidebarVirtualGroupObjectType = "table" | "view" | "materialized_view";
type ParentDescriptor = Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">;
type ObjectDescriptor = ParentDescriptor & Pick<TreeNode, "objectName" | "tableName" | "label">;

export interface SidebarVirtualGroup {
  id: string;
  name: string;
  expanded: boolean;
  members: string[];
  /** Missing in version 1; an absent/null parent means the category root. */
  parentId?: string | null;
}

interface SidebarVirtualGroupState {
  version: 2;
  scopes: Record<string, SidebarVirtualGroup[]>;
}

export const sidebarVirtualGroupsRevision = ref(0);
export const sidebarVirtualGroupsCanUndo = ref(false);
export const sidebarVirtualGroupsPersistenceError = ref<string | null>(null);
export const sidebarVirtualGroupsLoadError = ref<string | null>(null);
let unreadableBackup: string | null = null;

const emptyState = (): SidebarVirtualGroupState => ({ version: 2, scopes: {} });
const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function parseScope(scope: string): ParentDescriptor {
  const parts: unknown = JSON.parse(scope);
  if (!Array.isArray(parts) || parts.length !== 5 || !parts.every((part) => typeof part === "string")) throw new Error("Invalid folder scope");
  const [connectionId, database, catalog, schema, type] = parts as string[];
  const parent = { connectionId, database, catalog, schema, type: type as TreeNodeType };
  if (!supportsSidebarVirtualGroups(parent)) throw new Error("Invalid folder scope");
  return parent;
}

/** Validate the whole backup before accepting any part of it. */
function parseState(raw: string): SidebarVirtualGroupState {
  const input: unknown = JSON.parse(raw);
  if (!record(input) || (input.version !== 1 && input.version !== 2) || !record(input.scopes)) throw new Error("Unsupported folder backup format");
  const scopes: Record<string, SidebarVirtualGroup[]> = {};
  const allIds = new Set<string>();
  for (const [scope, values] of Object.entries(input.scopes)) {
    const parent = parseScope(scope);
    if (!Array.isArray(values)) throw new Error("Invalid folder list");
    const assigned = new Set<string>();
    const groups = values.map((value): SidebarVirtualGroup => {
      if (!record(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim() || !Array.isArray(value.members)) throw new Error("Invalid folder");
      if (allIds.has(value.id)) throw new Error("Duplicate folder ID");
      allIds.add(value.id);
      if (value.expanded !== undefined && typeof value.expanded !== "boolean") throw new Error("Invalid folder expansion state");
      if (value.parentId != null && (typeof value.parentId !== "string" || !value.parentId)) throw new Error("Invalid parent folder");
      const members = value.members.map((member: unknown): string => {
        if (typeof member !== "string") throw new Error("Invalid folder member");
        const key: unknown = JSON.parse(member);
        if (!Array.isArray(key) || key.length !== 4 || !key.every((part) => typeof part === "string") || !key[3] || sidebarVirtualGroupParentTypeForObject(key[0] as TreeNodeType) !== parent.type || key[1] !== parent.catalog || key[2] !== parent.schema)
          throw new Error("Folder member belongs to another scope");
        // Canonical JSON prevents whitespace variants from disguising duplicate membership.
        const normalized = JSON.stringify(key);
        if (assigned.has(normalized)) throw new Error("An object belongs to multiple folders");
        assigned.add(normalized);
        return normalized;
      });
      return { id: value.id, name: value.name.trim(), expanded: value.expanded !== false, members, parentId: (value.parentId as string | null | undefined) ?? null };
    });
    const byId = new Map(groups.map((group) => [group.id, group]));
    for (const group of groups) {
      if (groups.some((other) => other.id !== group.id && other.parentId === group.parentId && sameName(other.name, group.name))) throw new Error("Duplicate sibling folder name");
      const ancestors = new Set([group.id]);
      let parentId = group.parentId;
      while (parentId) {
        if (ancestors.has(parentId)) throw new Error("Folder hierarchy contains a cycle");
        const ancestor = byId.get(parentId);
        if (!ancestor) throw new Error("Parent folder does not exist in this scope");
        ancestors.add(parentId);
        parentId = ancestor.parentId;
      }
    }
    const canonicalScope = scopeKeyForParent(parent)!;
    if (Object.prototype.hasOwnProperty.call(scopes, canonicalScope)) throw new Error("Duplicate folder scope");
    scopes[canonicalScope] = groups;
  }
  return { version: 2, scopes };
}

function loadState(): SidebarVirtualGroupState {
  const raw = safeLocalStorageGet(STORAGE_KEY);
  if (!raw) return emptyState();
  try {
    return parseState(raw);
  } catch (error) {
    unreadableBackup = raw;
    sidebarVirtualGroupsLoadError.value = error instanceof Error ? error.message : "Unable to read saved folders";
    // Do not overwrite the original bytes when loading a damaged/unsupported backup.
    return emptyState();
  }
}

let state = loadState();
let undoStack: SidebarVirtualGroupState[] = [];

/** Publish only after persistence succeeds: a failed disk write never pretends to save a move. */
function commitState(next: SidebarVirtualGroupState, remember = true, recover = false): boolean {
  if (sidebarVirtualGroupsLoadError.value && !recover) {
    sidebarVirtualGroupsPersistenceError.value = "已保存的虚拟文件夹数据无法读取；请先导出备份，再通过导入有效备份恢复";
    return false;
  }
  if (!safeLocalStorageSet(STORAGE_KEY, JSON.stringify(next))) {
    sidebarVirtualGroupsPersistenceError.value = "无法保存虚拟文件夹，请检查本地存储空间和权限后重试";
    return false;
  }
  if (remember) undoStack = [...undoStack.slice(-(MAX_UNDO - 1)), state];
  state = next;
  sidebarVirtualGroupsPersistenceError.value = null;
  sidebarVirtualGroupsLoadError.value = null;
  unreadableBackup = null;
  sidebarVirtualGroupsCanUndo.value = undoStack.length > 0;
  sidebarVirtualGroupsRevision.value += 1;
  return true;
}

function replaceScope(scope: string, groups: SidebarVirtualGroup[], remember = true): boolean {
  const scopes = { ...state.scopes };
  if (groups.length) scopes[scope] = groups;
  else delete scopes[scope];
  return commitState({ ...state, scopes }, remember);
}

function newId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUuid ? randomUuid() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sidebarVirtualGroupParentTypeForObject(type: TreeNodeType): SidebarVirtualGroupParentType | null {
  if (type === "table") return "group-tables";
  if (type === "view") return "group-views";
  if (type === "materialized_view") return "group-materialized-views";
  return null;
}

export function supportsSidebarVirtualGroups(node: ParentDescriptor): node is ParentDescriptor & { type: SidebarVirtualGroupParentType; connectionId: string; database: string } {
  return (node.type === "group-tables" || node.type === "group-views" || node.type === "group-materialized-views") && typeof node.connectionId === "string" && !!node.connectionId && typeof node.database === "string" && !!node.database;
}

function scopeKeyForParent(node: ParentDescriptor): string | null {
  if (!supportsSidebarVirtualGroups(node)) return null;
  return JSON.stringify([node.connectionId, node.database, node.catalog ?? "", node.schema ?? "", node.type]);
}

function parentDescriptorForObject(node: ParentDescriptor): ParentDescriptor | null {
  const type = sidebarVirtualGroupParentTypeForObject(node.type);
  return type && node.connectionId && node.database ? { type, connectionId: node.connectionId, database: node.database, catalog: node.catalog, schema: node.schema } : null;
}

export function sidebarVirtualGroupObjectKey(node: Pick<TreeNode, "type" | "catalog" | "schema" | "objectName" | "tableName" | "label">): string | null {
  if (!sidebarVirtualGroupParentTypeForObject(node.type)) return null;
  // Quoted database identifiers may contain leading/trailing spaces: never trim them.
  const name = node.objectName ?? node.tableName ?? node.label;
  return name ? JSON.stringify([node.type, node.catalog ?? "", node.schema ?? "", name]) : null;
}

function groupsForScope(scope: string | null): SidebarVirtualGroup[] {
  return scope ? (state.scopes[scope] ?? []) : [];
}

export function sidebarVirtualGroupsForParent(node: ParentDescriptor): readonly SidebarVirtualGroup[] {
  void sidebarVirtualGroupsRevision.value;
  return groupsForScope(scopeKeyForParent(node));
}

export function sidebarVirtualGroupsForObject(node: ObjectDescriptor): { groups: readonly SidebarVirtualGroup[]; currentGroupId: string | null } {
  void sidebarVirtualGroupsRevision.value;
  const parent = parentDescriptorForObject(node);
  const key = sidebarVirtualGroupObjectKey(node);
  const groups = parent ? groupsForScope(scopeKeyForParent(parent)) : [];
  return { groups, currentGroupId: key ? (groups.find((group) => group.members.includes(key))?.id ?? null) : null };
}

export function sidebarVirtualGroupInfo(groupId: string): { group: SidebarVirtualGroup; groups: readonly SidebarVirtualGroup[]; parent: ParentDescriptor } | null {
  void sidebarVirtualGroupsRevision.value;
  for (const [scope, groups] of Object.entries(state.scopes)) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (group) return { group, groups, parent: parseScope(scope) };
  }
  return null;
}

export function sidebarVirtualGroupPath(groupId: string): string {
  const info = sidebarVirtualGroupInfo(groupId);
  if (!info) return "";
  const names = [info.group.name];
  let parentId = info.group.parentId;
  while (parentId) {
    const parent = info.groups.find((group) => group.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" / ");
}

export function createSidebarVirtualGroup(parent: ParentDescriptor, name: string, parentGroupId: string | null = null): SidebarVirtualGroup | null {
  return createSidebarVirtualGroupWithObjects(parent, name, [], parentGroupId);
}

/** Create and populate a folder in one transaction/undo step, including quota failures. */
export function createSidebarVirtualGroupWithObjects(parent: ParentDescriptor, name: string, nodes: readonly ObjectDescriptor[], parentGroupId: string | null = null): SidebarVirtualGroup | null {
  const scope = scopeKeyForParent(parent);
  const normalizedName = name.trim();
  if (!scope || !normalizedName || normalizedName.length > MAX_FOLDER_NAME) return null;
  const move = nodes.length ? objectMoveScope(nodes, null) : null;
  if (nodes.length && (!move || move.scope !== scope)) return null;
  const groups = groupsForScope(scope);
  if (parentGroupId && !groups.some((group) => group.id === parentGroupId)) return null;
  if (groups.some((group) => (group.parentId ?? null) === parentGroupId && sameName(group.name, normalizedName))) return null;
  const group: SidebarVirtualGroup = { id: newId(), name: normalizedName, expanded: true, members: [...(move?.keys ?? [])], parentId: parentGroupId };
  const next = groups.map((candidate) => ({ ...candidate, members: candidate.members.filter((key) => !move?.keys.has(key)), expanded: candidate.id === parentGroupId ? true : candidate.expanded }));
  return replaceScope(scope, [...next, group]) ? group : null;
}

function updateGroupById(groupId: string, updater: (group: SidebarVirtualGroup, groups: SidebarVirtualGroup[]) => SidebarVirtualGroup[] | null, remember = true): boolean {
  for (const [scope, groups] of Object.entries(state.scopes)) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) continue;
    const next = updater(group, groups);
    return !!next && replaceScope(scope, next, remember);
  }
  return false;
}

export function renameSidebarVirtualGroup(groupId: string, name: string): boolean {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > MAX_FOLDER_NAME) return false;
  return updateGroupById(groupId, (group, groups) => {
    if (group.name === normalizedName || groups.some((other) => other.id !== group.id && (other.parentId ?? null) === (group.parentId ?? null) && sameName(other.name, normalizedName))) return null;
    return groups.map((other) => (other.id === group.id ? { ...other, name: normalizedName } : other));
  });
}

/** Dissolve the entire folder subtree. Real objects stay in the database/category. */
export function deleteSidebarVirtualGroup(groupId: string): boolean {
  return updateGroupById(groupId, (group, groups) => {
    const removed = new Set([group.id]);
    let previousSize = 0;
    while (previousSize !== removed.size) {
      previousSize = removed.size;
      for (const candidate of groups) if (candidate.parentId && removed.has(candidate.parentId)) removed.add(candidate.id);
    }
    return groups.filter((candidate) => !removed.has(candidate.id));
  });
}

export function setSidebarVirtualGroupExpanded(groupId: string, expanded: boolean): boolean {
  return updateGroupById(groupId, (group, groups) => (group.expanded === expanded ? null : groups.map((candidate) => (candidate.id === group.id ? { ...candidate, expanded } : candidate))), false);
}

export function setSidebarVirtualGroupsExpanded(parent: ParentDescriptor, expanded: boolean): boolean {
  const scope = scopeKeyForParent(parent);
  if (!scope) return false;
  const groups = groupsForScope(scope);
  if (!groups.some((group) => group.expanded !== expanded)) return false;
  return replaceScope(
    scope,
    groups.map((group) => ({ ...group, expanded })),
    false,
  );
}

/** Reveal a located object without expanding unrelated folder branches. */
export function expandSidebarVirtualGroupsForObject(node: ObjectDescriptor): boolean {
  const parent = parentDescriptorForObject(node);
  const scope = parent ? scopeKeyForParent(parent) : null;
  const key = sidebarVirtualGroupObjectKey(node);
  if (!scope || !key) return false;
  const groups = groupsForScope(scope);
  let folder = groups.find((group) => group.members.includes(key));
  const ancestors = new Set<string>();
  while (folder) {
    ancestors.add(folder.id);
    const parentId = folder.parentId;
    folder = groups.find((group) => group.id === parentId);
  }
  if (!groups.some((group) => ancestors.has(group.id) && !group.expanded)) return false;
  return replaceScope(
    scope,
    groups.map((group) => (ancestors.has(group.id) ? { ...group, expanded: true } : group)),
    false,
  );
}

export function canMoveSidebarVirtualGroup(groupId: string, parentGroupId: string | null): boolean {
  const info = sidebarVirtualGroupInfo(groupId);
  if (!info || groupId === parentGroupId) return false;
  if (info.groups.some((group) => group.id !== groupId && (group.parentId ?? null) === parentGroupId && sameName(group.name, info.group.name))) return false;
  let ancestorId = parentGroupId;
  while (ancestorId) {
    if (ancestorId === groupId) return false;
    const ancestor = info.groups.find((group) => group.id === ancestorId);
    if (!ancestor) return false;
    ancestorId = ancestor.parentId ?? null;
  }
  return true;
}

export function moveSidebarVirtualGroup(groupId: string, parentGroupId: string | null): boolean {
  if (!canMoveSidebarVirtualGroup(groupId, parentGroupId)) return false;
  return updateGroupById(groupId, (group, groups) => ((group.parentId ?? null) === parentGroupId ? null : groups.map((candidate) => (candidate.id === groupId ? { ...candidate, parentId: parentGroupId } : candidate.id === parentGroupId ? { ...candidate, expanded: true } : candidate))));
}

/** Move one step among siblings; child folders keep their own order and ownership. */
export function reorderSidebarVirtualGroup(groupId: string, direction: "up" | "down"): boolean {
  return updateGroupById(groupId, (group, groups) => {
    const siblings = groups.filter((candidate) => (candidate.parentId ?? null) === (group.parentId ?? null));
    const sibling = siblings[siblings.findIndex((candidate) => candidate.id === groupId) + (direction === "up" ? -1 : 1)];
    if (!sibling) return null;
    const next = [...groups];
    const from = groups.indexOf(group);
    const to = groups.indexOf(sibling);
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });
}

function objectMoveScope(nodes: readonly ObjectDescriptor[], groupId: string | null): { scope: string; keys: Set<string> } | null {
  if (!nodes.length) return null;
  let scope: string | null = null;
  const keys = new Set<string>();
  for (const node of nodes) {
    const parent = parentDescriptorForObject(node);
    const nextScope = parent ? scopeKeyForParent(parent) : null;
    const key = sidebarVirtualGroupObjectKey(node);
    if (!nextScope || !key || (scope !== null && scope !== nextScope)) return null;
    scope = nextScope;
    keys.add(key);
  }
  if (!scope || (groupId !== null && !groupsForScope(scope).some((group) => group.id === groupId))) return null;
  return { scope, keys };
}

export function canMoveSidebarObjectsToVirtualGroup(nodes: readonly ObjectDescriptor[], groupId: string | null): boolean {
  return objectMoveScope(nodes, groupId) !== null;
}

/** Validate all items first and persist once, so an invalid mixed selection never partially moves. */
export function moveSidebarObjectsToVirtualGroup(nodes: readonly ObjectDescriptor[], groupId: string | null): boolean {
  const move = objectMoveScope(nodes, groupId);
  if (!move) return false;
  let changed = false;
  const next = groupsForScope(move.scope).map((group) => {
    const members = group.id === groupId ? [...group.members, ...[...move.keys].filter((key) => !group.members.includes(key))] : group.members.filter((key) => !move.keys.has(key));
    if (members.length === group.members.length && members.every((key, index) => key === group.members[index])) return group;
    changed = true;
    return { ...group, members, expanded: group.id === groupId ? true : group.expanded };
  });
  return changed && replaceScope(move.scope, next);
}

export function moveSidebarObjectToVirtualGroup(node: ObjectDescriptor, groupId: string | null): boolean {
  return moveSidebarObjectsToVirtualGroup([node], groupId);
}

export function exportSidebarVirtualGroups(): string {
  return unreadableBackup ?? JSON.stringify(state, null, 2);
}

/** Replace from a validated backup; the replaced state remains available through Undo. */
export function importSidebarVirtualGroups(json: string): { success: boolean; error?: string } {
  let next: SidebarVirtualGroupState;
  try {
    next = parseState(json);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Invalid folder backup" };
  }
  return commitState(next, !sidebarVirtualGroupsLoadError.value, true) ? { success: true } : { success: false, error: sidebarVirtualGroupsPersistenceError.value ?? "Unable to save folders" };
}

export function undoSidebarVirtualGroups(): boolean {
  const previous = undoStack[undoStack.length - 1];
  if (!previous || !commitState(previous, false)) return false;
  undoStack = undoStack.slice(0, -1);
  sidebarVirtualGroupsCanUndo.value = undoStack.length > 0;
  return true;
}

export function sidebarVirtualGroupIdFromNode(node: Pick<TreeNode, "id">): string | null {
  const index = node.id.lastIndexOf(VIRTUAL_GROUP_ID_MARKER);
  if (index < 0) return null;
  const encoded = node.id.slice(index + VIRTUAL_GROUP_ID_MARKER.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function isSidebarVirtualGroupNode(node: Pick<TreeNode, "id" | "type">): boolean {
  return node.type === "virtual-object-group" && sidebarVirtualGroupIdFromNode(node) !== null;
}

interface ProjectionOptions {
  forceExpanded?: boolean;
  collapsedNodeIds?: ReadonlySet<string>;
}

function projectNode(node: TreeNode, options: ProjectionOptions): TreeNode {
  const projectedChildren = node.children?.map((child) => projectNode(child, options));
  const base = projectedChildren ? { ...node, children: projectedChildren } : node;
  if (!supportsSidebarVirtualGroups(base)) return base;

  // Flatten a prior projection first. This keeps filtering/reprojection idempotent,
  // and preserves real objects when a folder was removed since the last projection.
  const sourceChildren: TreeNode[] = [];
  const collect = (children: readonly TreeNode[]) => {
    for (const child of children) {
      if (isSidebarVirtualGroupNode(child)) collect(child.children ?? []);
      else sourceChildren.push(child);
    }
  };
  collect(projectedChildren ?? []);
  const groups = groupsForScope(scopeKeyForParent(base));
  if (!groups.length) return projectedChildren ? { ...base, children: sourceChildren } : base;

  const objectByKey = new Map<string, TreeNode>();
  for (const object of sourceChildren) {
    if (sidebarVirtualGroupParentTypeForObject(object.type) !== base.type) continue;
    const key = sidebarVirtualGroupObjectKey(object);
    if (key) objectByKey.set(key, object);
  }
  const assigned = new Set<string>();
  const buildFolder = (group: SidebarVirtualGroup): TreeNode => {
    const folders = groups.filter((candidate) => candidate.parentId === group.id).map(buildFolder);
    const objects: TreeNode[] = [];
    for (const member of group.members) {
      const object = objectByKey.get(member);
      if (!object || assigned.has(member)) continue;
      assigned.add(member);
      objects.push(object);
    }
    const id = `${base.id}${VIRTUAL_GROUP_ID_MARKER}${encodeURIComponent(group.id)}`;
    return {
      id,
      label: group.name,
      type: "virtual-object-group",
      connectionId: base.connectionId,
      database: base.database,
      catalog: base.catalog,
      schema: base.schema,
      objectCount: objects.length + folders.reduce((sum, folder) => sum + (folder.objectCount ?? 0), 0),
      isExpanded: options.forceExpanded ? !options.collapsedNodeIds?.has(id) : group.expanded,
      children: [...folders, ...objects],
      searchAliases: ["virtual group", "virtual folder"],
    };
  };
  const folders = groups.filter((group) => !group.parentId).map(buildFolder);
  const ungrouped = sourceChildren.filter((child) => sidebarVirtualGroupParentTypeForObject(child.type) !== base.type || !assigned.has(sidebarVirtualGroupObjectKey(child) ?? ""));
  return { ...base, children: [...folders, ...ungrouped] };
}

export function applySidebarVirtualGroups(nodes: readonly TreeNode[], options: ProjectionOptions = {}): TreeNode[] {
  void sidebarVirtualGroupsRevision.value;
  return nodes.map((node) => projectNode(node, options));
}

/** Test-only helper kept out of production call sites. */
export function resetSidebarVirtualGroupsForTests() {
  state = emptyState();
  undoStack = [];
  sidebarVirtualGroupsCanUndo.value = false;
  sidebarVirtualGroupsLoadError.value = null;
  unreadableBackup = null;
  commitState(state, false);
}
