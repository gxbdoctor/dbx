from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, got {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(path: str, old: str, new: str, expected: int | None = None) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if expected is not None and count != expected:
        raise RuntimeError(f"Expected {expected} matches in {path}, got {count}: {old[:120]!r}")
    if count == 0:
        raise RuntimeError(f"No matches in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# 1) Dedicated tree node type.
replace_once(
    "apps/desktop/src/types/database.ts",
    '  | "group-materialized-views"\n  | "group-procedures"',
    '  | "group-materialized-views"\n  | "virtual-object-group"\n  | "group-procedures"',
)

# 2) Virtual-group model: stop impersonating partition groups.
replace_once(
    "apps/desktop/src/lib/sidebar/sidebarVirtualGroups.ts",
    '  return node.type === "group-partitions" && sidebarVirtualGroupIdFromNode(node) !== null;',
    '  return node.type === "virtual-object-group" && sidebarVirtualGroupIdFromNode(node) !== null;',
)
replace_once(
    "apps/desktop/src/lib/sidebar/sidebarVirtualGroups.ts",
    '      type: "group-partitions",',
    '      type: "virtual-object-group",',
)

# Make move bookkeeping deterministic and avoid cloning unaffected groups after the first change.
replace_once(
    "apps/desktop/src/lib/sidebar/sidebarVirtualGroups.ts",
    '''  let changed = false;\n  const nextGroups = groups.map((group) => {\n    const withoutObject = group.members.filter((member) => member !== objectKey);\n    const shouldContain = group.id === groupId;\n    const nextMembers = shouldContain ? [...withoutObject, objectKey] : withoutObject;\n    if (nextMembers.length !== group.members.length || nextMembers.some((member, index) => member !== group.members[index])) changed = true;\n    return changed ? { ...group, members: nextMembers } : group;\n  });''',
    '''  let changed = false;\n  const nextGroups = groups.map((group) => {\n    const withoutObject = group.members.filter((member) => member !== objectKey);\n    const shouldContain = group.id === groupId;\n    const nextMembers = shouldContain ? [...withoutObject, objectKey] : withoutObject;\n    const groupChanged = nextMembers.length !== group.members.length || nextMembers.some((member, index) => member !== group.members[index]);\n    if (groupChanged) changed = true;\n    return groupChanged ? { ...group, members: nextMembers } : group;\n  });''',
)

# 3) Project virtual folders only at the final display layer, so remote search/loading stays untouched.
replace_once(
    "apps/desktop/src/components/sidebar/ConnectionTree.vue",
    'import { compileSearchRegex } from "@/lib/common/searchPattern";',
    'import { compileSearchRegex } from "@/lib/common/searchPattern";\nimport { applySidebarVirtualGroups } from "@/lib/sidebar/sidebarVirtualGroups";',
)
replace_once(
    "apps/desktop/src/components/sidebar/ConnectionTree.vue",
    'insertSidebarTableSearchControls(flattenTree(filteredNodes.value), {',
    'insertSidebarTableSearchControls(flattenTree(applySidebarVirtualGroups(filteredNodes.value)), {',
)

# 4) Folder presentation/expandability.
replace_once(
    "apps/desktop/src/components/sidebar/TreeItem.vue",
    '''    case "saved-sql-folder":\n      return { icon: node.isExpanded ? FolderOpen : FolderClosed, colorClass: "text-blue-400" };''',
    '''    case "saved-sql-folder":\n      return { icon: node.isExpanded ? FolderOpen : FolderClosed, colorClass: "text-blue-400" };\n    case "virtual-object-group":\n      return { icon: node.isExpanded ? FolderOpen : FolderClosed, colorClass: "text-indigo-400" };''',
)
replace_once(
    "apps/desktop/src/lib/sidebar/treeNodeIcon.ts",
    '''    case "group-materialized-views":\n      return { icon: Eye, colorClass: "text-indigo-500" };''',
    '''    case "group-materialized-views":\n      return { icon: Eye, colorClass: "text-indigo-500" };\n    case "virtual-object-group":\n      return { icon: node.isExpanded ? FolderOpen : FolderClosed, colorClass: "text-indigo-400" };''',
)
replace_once(
    "apps/desktop/src/lib/sidebar/sidebarTreeItemLayout.ts",
    'const emptyContainerTypes: Set<TreeNodeType> = new Set(["saved-sql-root", "saved-sql-folder", "type"]);',
    'const emptyContainerTypes: Set<TreeNodeType> = new Set(["saved-sql-root", "saved-sql-folder", "virtual-object-group", "type"]);',
)
replace_once(
    "apps/desktop/src/lib/sidebar/treeNodeGroup.ts",
    '  "group-materialized-views",\n  "group-procedures",',
    '  "group-materialized-views",\n  "virtual-object-group",\n  "group-procedures",',
)

# 5) Runtime actions and context menus.
RUNTIME = "apps/desktop/src/components/sidebar/SidebarTreeRuntimeHost.vue"
replace_once(
    RUNTIME,
    'import { flattenTree } from "@/composables/useFlatTree";',
    '''import { flattenTree } from "@/composables/useFlatTree";\nimport {\n  createSidebarVirtualGroup,\n  deleteSidebarVirtualGroup,\n  isSidebarVirtualGroupNode,\n  moveSidebarObjectToVirtualGroup,\n  renameSidebarVirtualGroup,\n  setSidebarVirtualGroupExpanded,\n  sidebarVirtualGroupIdFromNode,\n  sidebarVirtualGroupParentTypeForObject,\n  sidebarVirtualGroupsForObject,\n  supportsSidebarVirtualGroups,\n} from "@/lib/sidebar/sidebarVirtualGroups";''',
)
replace_once(
    RUNTIME,
    '  "group-materialized-views",\n  "group-procedures",',
    '  "group-materialized-views",\n  "virtual-object-group",\n  "group-procedures",',
)

# Virtual folder toggle persists locally and never asks the DB metadata loader.
replace_once(
    RUNTIME,
    '''  if (node.type === "group-partitions") {\n    node.isExpanded = !node.isExpanded;\n    emitNodeToggled(node, wasExpanded);\n    return;\n  }''',
    '''  if (isSidebarVirtualGroupNode(node)) {\n    const groupId = sidebarVirtualGroupIdFromNode(node);\n    const expanded = !node.isExpanded;\n    if (groupId) setSidebarVirtualGroupExpanded(groupId, expanded);\n    node.isExpanded = expanded;\n    emitNodeToggled(node, wasExpanded, expanded);\n    return;\n  }\n\n  if (node.type === "group-partitions") {\n    node.isExpanded = !node.isExpanded;\n    emitNodeToggled(node, wasExpanded);\n    return;\n  }''',
)

# Keyboard shortcuts: refresh must not reach the database; F2/Delete operate on local folders.
replace_once(
    RUNTIME,
    '''function canRefreshTreeNodeShortcut(): boolean {\n  const type = activeNode.value.type;''',
    '''function canRefreshTreeNodeShortcut(): boolean {\n  if (isSidebarVirtualGroupNode(activeNode.value)) return false;\n  const type = activeNode.value.type;''',
)
replace_once(
    RUNTIME,
    '''  if (activeNode.value.type === "connection-group") {\n    startRenameGroup();\n    return true;\n  }''',
    '''  if (isSidebarVirtualGroupNode(activeNode.value)) {\n    renameActiveVirtualGroup();\n    return true;\n  }\n  if (activeNode.value.type === "connection-group") {\n    startRenameGroup();\n    return true;\n  }''',
)
replace_once(
    RUNTIME,
    '''  if (activeNode.value.type === "saved-sql-file" && activeNode.value.savedSqlId) {\n    showDeleteSavedSqlConfirm.value = true;\n    return true;\n  }''',
    '''  if (activeNode.value.type === "saved-sql-file" && activeNode.value.savedSqlId) {\n    showDeleteSavedSqlConfirm.value = true;\n    return true;\n  }\n  if (isSidebarVirtualGroupNode(activeNode.value)) {\n    deleteActiveVirtualGroup();\n    return true;\n  }''',
)

# Helpers use native prompt/confirm for V1 to avoid touching DBX's database mutation dialogs.
insert_anchor = '''function moreActionsSubmenu(children: ContextMenuItem[]): ContextMenuItem {\n  return {\n    label: t("common.more"),\n    icon: ListTree,\n    variant: "destructive",\n    children,\n  };\n}\n'''
helpers = insert_anchor + '''\nfunction virtualGroupParentForObject(node: TreeNode): TreeNode | null {\n  const type = sidebarVirtualGroupParentTypeForObject(node.type);\n  if (!type || !node.connectionId || !node.database) return null;\n  return {\n    id: `${node.id}:__virtual_group_parent`,\n    label: "",\n    type,\n    connectionId: node.connectionId,\n    database: node.database,\n    catalog: node.catalog,\n    schema: node.schema,\n  };\n}\n\nfunction promptCreateVirtualGroup(parent: TreeNode, moveNode?: TreeNode) {\n  const name = window.prompt("虚拟分组名称");\n  if (!name?.trim()) return;\n  const created = createSidebarVirtualGroup(parent, name);\n  if (!created) {\n    toast("虚拟分组名称无效或已存在", 3000);\n    return;\n  }\n  if (moveNode) moveSidebarObjectToVirtualGroup(moveNode, created.id);\n}\n\nfunction renameActiveVirtualGroup() {\n  const node = activeNode.value;\n  const groupId = sidebarVirtualGroupIdFromNode(node);\n  if (!groupId) return;\n  const name = window.prompt("重命名虚拟分组", node.label);\n  if (!name?.trim() || name.trim() === node.label) return;\n  if (!renameSidebarVirtualGroup(groupId, name)) toast("虚拟分组名称无效或已存在", 3000);\n}\n\nfunction deleteActiveVirtualGroup() {\n  const node = activeNode.value;\n  const groupId = sidebarVirtualGroupIdFromNode(node);\n  if (!groupId) return;\n  if (!window.confirm(`删除虚拟分组“${node.label}”？\\n\\n分组内的数据库对象不会被删除，将回到未分组列表。`)) return;\n  deleteSidebarVirtualGroup(groupId);\n}\n\nfunction virtualGroupMoveMenu(node: TreeNode): ContextMenuItem {\n  const { groups, currentGroupId } = sidebarVirtualGroupsForObject(node);\n  const parent = virtualGroupParentForObject(node);\n  const children: ContextMenuItem[] = groups.map((group) => ({\n    label: group.name,\n    icon: FolderOpen,\n    disabled: currentGroupId === group.id,\n    action: () => moveSidebarObjectToVirtualGroup(node, group.id),\n  }));\n  if (groups.length) children.push({ label: "", separator: true });\n  children.push({\n    label: "未分组",\n    disabled: currentGroupId === null,\n    action: () => moveSidebarObjectToVirtualGroup(node, null),\n  });\n  if (parent) {\n    children.push({ label: "", separator: true });\n    children.push({ label: "新建虚拟分组…", icon: FolderPlus, action: () => promptCreateVirtualGroup(parent, node) });\n  }\n  return { label: "移动到虚拟分组", icon: FolderInput, children };\n}\n'''
replace_once(RUNTIME, insert_anchor, helpers)

# Add move submenu to ordinary table/view/materialized-view menu.
replace_once(
    RUNTIME,
    '''    items.push(copyNameMenuItem());\n    items.push({ label: t("contextMenu.newQuery"), action: newQuery, icon: TerminalSquare });''',
    '''    items.push(copyNameMenuItem());\n    items.push(virtualGroupMoveMenu(node));\n    items.push({ label: t("contextMenu.newQuery"), action: newQuery, icon: TerminalSquare });''',
)

# Virtual folder gets local-only menu; real object group gets New Virtual Group.
replace_once(
    RUNTIME,
    '''function buildObjectGroupSidebarMenu(context: SidebarMenuFactoryContext): boolean {\n  const { node, items } = context;\n  // 9. Group Labels (group-columns, group-tables, etc.)\n  if (isGroupLabel(node)) {''',
    '''function buildObjectGroupSidebarMenu(context: SidebarMenuFactoryContext): boolean {\n  const { node, items } = context;\n  if (isSidebarVirtualGroupNode(node)) {\n    items.push({ label: "重命名虚拟分组", action: renameActiveVirtualGroup, icon: Pencil, shortcut: shortcutRename });\n    items.push({ label: "删除虚拟分组", action: deleteActiveVirtualGroup, icon: Trash2, shortcut: shortcutDelete, variant: "destructive" as const });\n    return true;\n  }\n  // 9. Group Labels (group-columns, group-tables, etc.)\n  if (isGroupLabel(node)) {''',
)
replace_once(
    RUNTIME,
    '''    const canLoadAllObjectGroup = node.type === "group-tables" || node.type === "group-dolt-system-tables" || node.type === "group-views" || node.type === "group-materialized-views";''',
    '''    const canLoadAllObjectGroup = node.type === "group-tables" || node.type === "group-dolt-system-tables" || node.type === "group-views" || node.type === "group-materialized-views";\n    if (supportsSidebarVirtualGroups(node)) {\n      items.push({ label: "新建虚拟分组…", action: () => promptCreateVirtualGroup(node), icon: FolderPlus });\n    }''',
)

# 6) Unit tests for local persistence + projection.
test_path = ROOT / "apps/desktop/src/lib/__tests__/sidebar/sidebarVirtualGroups.spec.ts"
test_path.parent.mkdir(parents=True, exist_ok=True)
test_path.write_text('''import { beforeEach, describe, expect, it, vi } from "vitest";\nimport type { TreeNode } from "@/types/database";\nimport {\n  applySidebarVirtualGroups,\n  createSidebarVirtualGroup,\n  deleteSidebarVirtualGroup,\n  moveSidebarObjectToVirtualGroup,\n  renameSidebarVirtualGroup,\n  resetSidebarVirtualGroupsForTests,\n  sidebarVirtualGroupsForObject,\n} from "@/lib/sidebar/sidebarVirtualGroups";\n\nconst storage = new Map<string, string>();\n\nfunction matView(name: string): TreeNode {\n  return {\n    id: `c:db:s:__materialized_views:s:${name}`,\n    label: name,\n    type: "materialized_view",\n    connectionId: "c",\n    database: "db",\n    schema: "s",\n    children: [],\n  };\n}\n\nfunction parent(children: TreeNode[]): TreeNode {\n  return {\n    id: "c:db:s:__materialized_views",\n    label: "Materialized Views",\n    type: "group-materialized-views",\n    connectionId: "c",\n    database: "db",\n    schema: "s",\n    isExpanded: true,\n    children,\n  };\n}\n\ndescribe("sidebar virtual groups", () => {\n  beforeEach(() => {\n    storage.clear();\n    vi.stubGlobal("localStorage", {\n      getItem: vi.fn((key: string) => storage.get(key) ?? null),\n      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),\n      removeItem: vi.fn((key: string) => storage.delete(key)),\n    });\n    resetSidebarVirtualGroupsForTests();\n  });\n\n  it("projects assigned materialized views into a local folder without changing object identity", () => {\n    const a = matView("sdic_lab");\n    const b = matView("aki_48h");\n    const source = parent([a, b]);\n    const group = createSidebarVirtualGroup(source, "DIC / SIC");\n    expect(group).not.toBeNull();\n    expect(moveSidebarObjectToVirtualGroup(a, group!.id)).toBe(true);\n\n    const projectedParent = applySidebarVirtualGroups([source])[0];\n    const folder = projectedParent.children?.[0];\n    expect(folder?.type).toBe("virtual-object-group");\n    expect(folder?.label).toBe("DIC / SIC");\n    expect(folder?.children?.map((node) => node.label)).toEqual(["sdic_lab"]);\n    expect(folder?.children?.[0].id).toBe(a.id);\n    expect(projectedParent.children?.map((node) => node.label)).toContain("aki_48h");\n  });\n\n  it("renames, ungroups and deletes folders without touching database objects", () => {\n    const a = matView("sdic_lab");\n    const source = parent([a]);\n    const group = createSidebarVirtualGroup(source, "DIC")!;\n    moveSidebarObjectToVirtualGroup(a, group.id);\n    expect(renameSidebarVirtualGroup(group.id, "Coagulation")).toBe(true);\n    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBe(group.id);\n    expect(moveSidebarObjectToVirtualGroup(a, null)).toBe(true);\n    expect(sidebarVirtualGroupsForObject(a).currentGroupId).toBeNull();\n    expect(deleteSidebarVirtualGroup(group.id)).toBe(true);\n    expect(applySidebarVirtualGroups([source])[0].children?.[0].id).toBe(a.id);\n  });\n});\n''', encoding="utf-8")

print("Virtual Groups integration patch applied successfully.")
