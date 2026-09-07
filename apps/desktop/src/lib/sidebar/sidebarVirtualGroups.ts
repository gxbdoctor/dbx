import { ref } from "vue";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/backend/safeStorage";
import type { TreeNode, TreeNodeType } from "@/types/database";

const STORAGE_KEY = "dbx-sidebar-virtual-groups-v1";
const VIRTUAL_GROUP_ID_MARKER = ":__dbx_virtual_group:";

export type SidebarVirtualGroupParentType = "group-tables" | "group-views" | "group-materialized-views";
export type SidebarVirtualGroupObjectType = "table" | "view" | "materialized_view";

export interface SidebarVirtualGroup {
  id: string;
  name: string;
  expanded: boolean;
  members: string[];
}

interface SidebarVirtualGroupState {
  version: 1;
  scopes: Record<string, SidebarVirtualGroup[]>;
}

const emptyState = (): SidebarVirtualGroupState => ({ version: 1, scopes: {} });

function normalizeGroup(value: unknown): SidebarVirtualGroup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<SidebarVirtualGroup>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
  return {
    id: candidate.id,
    name: candidate.name.trim(),
    expanded: candidate.expanded !== false,
    members: Array.isArray(candidate.members) ? candidate.members.filter((member): member is string => typeof member === "string" && !!member) : [],
  };
}

function loadState(): SidebarVirtualGroupState {
  const raw = safeLocalStorageGet(STORAGE_KEY);
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw) as Partial<SidebarVirtualGroupState>;
    if (!parsed || parsed.version !== 1 || !parsed.scopes || typeof parsed.scopes !== "object" || Array.isArray(parsed.scopes)) return emptyState();
    const scopes: Record<string, SidebarVirtualGroup[]> = {};
    for (const [scope, groups] of Object.entries(parsed.scopes)) {
      if (!Array.isArray(groups)) continue;
      const normalized = groups.map(normalizeGroup).filter((group): group is SidebarVirtualGroup => !!group);
      if (normalized.length) scopes[scope] = normalized;
    }
    return { version: 1, scopes };
  } catch {
    return emptyState();
  }
}

let state = loadState();

/** Reactive invalidation signal. Any Vue computed that calls applySidebarVirtualGroups
 * automatically re-runs after a virtual-group mutation. */
export const sidebarVirtualGroupsRevision = ref(0);

function persistState() {
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(state));
  sidebarVirtualGroupsRevision.value += 1;
}

function newId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) return randomUuid();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sidebarVirtualGroupParentTypeForObject(type: TreeNodeType): SidebarVirtualGroupParentType | null {
  if (type === "table") return "group-tables";
  if (type === "view") return "group-views";
  if (type === "materialized_view") return "group-materialized-views";
  return null;
}

export function supportsSidebarVirtualGroups(node: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">): node is Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema"> & { type: SidebarVirtualGroupParentType; connectionId: string; database: string } {
  return (node.type === "group-tables" || node.type === "group-views" || node.type === "group-materialized-views") && typeof node.connectionId === "string" && !!node.connectionId && typeof node.database === "string" && !!node.database;
}

function scopeKeyForParent(node: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">): string | null {
  if (!supportsSidebarVirtualGroups(node)) return null;
  return JSON.stringify([node.connectionId, node.database, node.catalog ?? "", node.schema ?? "", node.type]);
}

function parentDescriptorForObject(node: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">): Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema"> | null {
  const parentType = sidebarVirtualGroupParentTypeForObject(node.type);
  if (!parentType || !node.connectionId || !node.database) return null;
  return {
    type: parentType,
    connectionId: node.connectionId,
    database: node.database,
    catalog: node.catalog,
    schema: node.schema,
  };
}

export function sidebarVirtualGroupObjectKey(node: Pick<TreeNode, "type" | "catalog" | "schema" | "objectName" | "tableName" | "label">): string | null {
  if (!sidebarVirtualGroupParentTypeForObject(node.type)) return null;
  const name = (node.objectName || node.tableName || node.label || "").trim();
  if (!name) return null;
  return JSON.stringify([node.type, node.catalog ?? "", node.schema ?? "", name]);
}

function groupsForScope(scope: string | null): SidebarVirtualGroup[] {
  return scope ? (state.scopes[scope] ?? []) : [];
}

export function sidebarVirtualGroupsForParent(node: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">): readonly SidebarVirtualGroup[] {
  return groupsForScope(scopeKeyForParent(node));
}

export function sidebarVirtualGroupsForObject(node: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema" | "objectName" | "tableName" | "label">): { groups: readonly SidebarVirtualGroup[]; currentGroupId: string | null } {
  const parent = parentDescriptorForObject(node);
  const objectKey = sidebarVirtualGroupObjectKey(node);
  const groups = parent ? groupsForScope(scopeKeyForParent(parent)) : [];
  if (!objectKey) return { groups, currentGroupId: null };
  return {
    groups,
    currentGroupId: groups.find((group) => group.members.includes(objectKey))?.id ?? null,
  };
}

export function createSidebarVirtualGroup(parent: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">, name: string): SidebarVirtualGroup | null {
  const scope = scopeKeyForParent(parent);
  const normalizedName = name.trim();
  if (!scope || !normalizedName) return null;
  const groups = state.scopes[scope] ?? [];
  if (groups.some((group) => group.name.localeCompare(normalizedName, undefined, { sensitivity: "accent" }) === 0)) return null;
  const group: SidebarVirtualGroup = { id: newId(), name: normalizedName, expanded: true, members: [] };
  state = { ...state, scopes: { ...state.scopes, [scope]: [...groups, group] } };
  persistState();
  return group;
}

function updateGroupById(groupId: string, updater: (group: SidebarVirtualGroup, groups: SidebarVirtualGroup[]) => SidebarVirtualGroup[] | null): boolean {
  for (const [scope, groups] of Object.entries(state.scopes)) {
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) continue;
    const nextGroups = updater(group, groups);
    if (!nextGroups) return false;
    const nextScopes = { ...state.scopes };
    if (nextGroups.length) nextScopes[scope] = nextGroups;
    else delete nextScopes[scope];
    state = { ...state, scopes: nextScopes };
    persistState();
    return true;
  }
  return false;
}

export function renameSidebarVirtualGroup(groupId: string, name: string): boolean {
  const normalizedName = name.trim();
  if (!normalizedName) return false;
  return updateGroupById(groupId, (group, groups) => {
    if (groups.some((candidate) => candidate.id !== group.id && candidate.name.localeCompare(normalizedName, undefined, { sensitivity: "accent" }) === 0)) return null;
    return groups.map((candidate) => (candidate.id === group.id ? { ...candidate, name: normalizedName } : candidate));
  });
}

export function deleteSidebarVirtualGroup(groupId: string): boolean {
  return updateGroupById(groupId, (group, groups) => groups.filter((candidate) => candidate.id !== group.id));
}

export function setSidebarVirtualGroupExpanded(groupId: string, expanded: boolean): boolean {
  return updateGroupById(groupId, (group, groups) => {
    if (group.expanded === expanded) return null;
    return groups.map((candidate) => (candidate.id === group.id ? { ...candidate, expanded } : candidate));
  });
}

export function moveSidebarObjectToVirtualGroup(node: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema" | "objectName" | "tableName" | "label">, groupId: string | null): boolean {
  const parent = parentDescriptorForObject(node);
  const scope = parent ? scopeKeyForParent(parent) : null;
  const objectKey = sidebarVirtualGroupObjectKey(node);
  if (!scope || !objectKey) return false;
  const groups = state.scopes[scope] ?? [];
  if (groupId && !groups.some((group) => group.id === groupId)) return false;

  let changed = false;
  const nextGroups = groups.map((group) => {
    const withoutObject = group.members.filter((member) => member !== objectKey);
    const shouldContain = group.id === groupId;
    const nextMembers = shouldContain ? [...withoutObject, objectKey] : withoutObject;
    const groupChanged = nextMembers.length !== group.members.length || nextMembers.some((member, index) => member !== group.members[index]);
    if (groupChanged) changed = true;
    return groupChanged ? { ...group, members: nextMembers } : group;
  });
  if (!changed) return false;
  state = { ...state, scopes: { ...state.scopes, [scope]: nextGroups } };
  persistState();
  return true;
}

export function sidebarVirtualGroupIdFromNode(node: Pick<TreeNode, "id">): string | null {
  const markerIndex = node.id.lastIndexOf(VIRTUAL_GROUP_ID_MARKER);
  if (markerIndex < 0) return null;
  const encoded = node.id.slice(markerIndex + VIRTUAL_GROUP_ID_MARKER.length);
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

function projectNode(node: TreeNode): TreeNode {
  const sourceChildren = node.children;
  const projectedChildren = sourceChildren?.map(projectNode);
  const base = projectedChildren ? { ...node, children: projectedChildren } : node;
  if (!supportsSidebarVirtualGroups(base) || !projectedChildren?.length) return base;

  const scope = scopeKeyForParent(base);
  const groups = groupsForScope(scope);
  if (!groups.length) return base;

  const expectedObjectParentType = base.type;
  const directObjects = projectedChildren.filter((child) => sidebarVirtualGroupParentTypeForObject(child.type) === expectedObjectParentType);
  if (!directObjects.length) return base;

  const objectByKey = new Map<string, TreeNode>();
  for (const object of directObjects) {
    const key = sidebarVirtualGroupObjectKey(object);
    if (key) objectByKey.set(key, object);
  }

  const assignedKeys = new Set<string>();
  const virtualNodes: TreeNode[] = [];
  for (const group of groups) {
    const children: TreeNode[] = [];
    for (const member of group.members) {
      const object = objectByKey.get(member);
      if (!object || assignedKeys.has(member)) continue;
      assignedKeys.add(member);
      children.push(object);
    }
    virtualNodes.push({
      id: `${base.id}${VIRTUAL_GROUP_ID_MARKER}${encodeURIComponent(group.id)}`,
      label: group.name,
      type: "virtual-object-group",
      connectionId: base.connectionId,
      database: base.database,
      catalog: base.catalog,
      schema: base.schema,
      objectCount: children.length,
      isExpanded: group.expanded,
      children,
      searchAliases: ["virtual group", "virtual folder"],
    });
  }

  const ungrouped = projectedChildren.filter((child) => {
    const objectParentType = sidebarVirtualGroupParentTypeForObject(child.type);
    if (objectParentType !== expectedObjectParentType) return true;
    const key = sidebarVirtualGroupObjectKey(child);
    return !key || !assignedKeys.has(key);
  });

  return { ...base, children: [...virtualNodes, ...ungrouped] };
}

export function applySidebarVirtualGroups(nodes: readonly TreeNode[]): TreeNode[] {
  // Reading the revision here creates a Vue dependency when flattenTree is
  // evaluated inside a computed, while remaining harmless in non-reactive tests.
  void sidebarVirtualGroupsRevision.value;
  return nodes.map(projectNode);
}

/** Test-only helper kept out of production call sites. */
export function resetSidebarVirtualGroupsForTests() {
  state = emptyState();
  persistState();
}
