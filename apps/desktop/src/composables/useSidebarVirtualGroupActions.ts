import { useI18n } from "vue-i18n";
import { FolderOpen, FolderPlus, FolderInput, Pencil, Trash2, Download, Upload, Undo2, ChevronsDown, ChevronsUp, ArrowUp, ArrowDown } from "@lucide/vue";
import type { ContextMenuItem } from "@/components/ui/CustomContextMenu.vue";
import type { TreeNode } from "@/types/database";
import { saveTextFile, compactLocalTimestamp } from "@/lib/export/saveTextFile";
import { openSidebarVirtualGroupDialog } from "@/lib/sidebar/sidebarVirtualGroupDialogs";
import {
  createSidebarVirtualGroupWithObjects,
  deleteSidebarVirtualGroup,
  renameSidebarVirtualGroup,
  sidebarVirtualGroupIdFromNode,
  sidebarVirtualGroupParentTypeForObject,
  sidebarVirtualGroupsForObject,
  sidebarVirtualGroupsForParent,
  sidebarVirtualGroupInfo,
  sidebarVirtualGroupPath,
  supportsSidebarVirtualGroups,
  isSidebarVirtualGroupNode,
  canMoveSidebarObjectsToVirtualGroup,
  moveSidebarObjectsToVirtualGroup,
  moveSidebarVirtualGroup,
  setSidebarVirtualGroupsExpanded,
  sidebarVirtualGroupsCanUndo,
  sidebarVirtualGroupsPersistenceError,
  sidebarVirtualGroupsLoadError,
  canMoveSidebarVirtualGroup,
  reorderSidebarVirtualGroup,
  exportSidebarVirtualGroups,
  importSidebarVirtualGroups,
  undoSidebarVirtualGroups,
} from "@/lib/sidebar/sidebarVirtualGroups";

export function virtualGroupSelection(active: TreeNode, selected: readonly TreeNode[]): TreeNode[] {
  return selected.length > 1 && selected.some((node) => node.id === active.id) ? [...selected] : [active];
}

export function useSidebarVirtualGroupActions(options: { activeNode: () => TreeNode; selectedNodes: () => TreeNode[]; toast: (message: string, duration?: number) => void }) {
  const { locale } = useI18n();
  const text = (zh: string, en: string) => (locale.value.startsWith("zh") ? zh : en);
  const failure = () => sidebarVirtualGroupsPersistenceError.value || sidebarVirtualGroupsLoadError.value || text("名称为空、过长、同级重名，或目标已改变。请重试。", "The name is empty, too long, duplicated, or the target has changed. Please retry.");
  const localOnly = () => text("文件夹仅保存在本机。操作不会修改数据库对象。", "Folders are stored locally. These actions do not modify database objects.");
  const dialogLabels = () => ({ cancelLabel: text("取消", "Cancel"), fieldLabel: text("文件夹名称", "Folder name") });
  const selected = (node: TreeNode) => virtualGroupSelection(node, options.selectedNodes());

  function parentFor(node: TreeNode): TreeNode | null {
    if (supportsSidebarVirtualGroups(node)) return node;
    const id = sidebarVirtualGroupIdFromNode(node);
    if (isSidebarVirtualGroupNode(node) && id) {
      const info = sidebarVirtualGroupInfo(id);
      return info ? ({ ...info.parent, id: node.id, label: "" } as TreeNode) : null;
    }
    const type = sidebarVirtualGroupParentTypeForObject(node.type);
    return type && node.connectionId && node.database ? { ...node, type } : null;
  }

  function create(node: TreeNode, moveNodes: TreeNode[] = []) {
    const parent = parentFor(node);
    if (!parent) return;
    const parentId = isSidebarVirtualGroupNode(node) ? sidebarVirtualGroupIdFromNode(node) : null;
    openSidebarVirtualGroupDialog({
      ...dialogLabels(),
      kind: "name",
      title: text("新建虚拟文件夹", "New virtual folder"),
      description: localOnly(),
      submitLabel: text("创建", "Create"),
      submit: (name) => {
        // Validate the whole selection before creating anything.
        if (moveNodes.length && !canMoveSidebarObjectsToVirtualGroup(moveNodes, null)) return text("所选对象必须属于同一连接、数据库、Schema 和对象类型。", "Select objects from the same connection, database, schema and object type.");
        const group = createSidebarVirtualGroupWithObjects(parent, name, moveNodes, parentId);
        if (!group) return failure();
        return null;
      },
    });
  }

  function rename(node = options.activeNode()) {
    const id = sidebarVirtualGroupIdFromNode(node);
    if (!id) return;
    openSidebarVirtualGroupDialog({
      ...dialogLabels(),
      kind: "name",
      title: text("重命名虚拟文件夹", "Rename virtual folder"),
      description: localOnly(),
      initialValue: node.label,
      submitLabel: text("保存", "Save"),
      submit: (name) => (name.trim() === node.label || renameSidebarVirtualGroup(id, name) ? null : failure()),
    });
  }

  function remove(node = options.activeNode()) {
    const id = sidebarVirtualGroupIdFromNode(node);
    if (!id) return;
    openSidebarVirtualGroupDialog({
      ...dialogLabels(),
      kind: "confirm",
      title: text("删除虚拟文件夹", "Delete virtual folder"),
      description: text(`删除“${node.label}”及其子文件夹？所有对象将回到未分组列表，数据库对象不会被删除。可以通过“撤销文件夹操作”恢复。`, `Delete “${node.label}” and its subfolders? All objects return to the ungrouped list. Database objects are preserved. You can undo this action.`),
      submitLabel: text("删除文件夹", "Delete folder"),
      destructive: true,
      submit: () => (deleteSidebarVirtualGroup(id) ? null : failure()),
    });
  }

  function moveObjects(nodes: TreeNode[], id: string | null) {
    if (!moveSidebarObjectsToVirtualGroup(nodes, id)) options.toast(failure(), 3500);
  }

  function moveMenu(node: TreeNode): ContextMenuItem {
    const nodes = selected(node);
    const { groups } = sidebarVirtualGroupsForObject(node);
    const compatible = canMoveSidebarObjectsToVirtualGroup(nodes, null);
    const allIn = (id: string | null) => nodes.every((item) => sidebarVirtualGroupsForObject(item).currentGroupId === id);
    const children: ContextMenuItem[] = groups.map((group) => ({
      label: sidebarVirtualGroupPath(group.id),
      icon: FolderOpen,
      disabled: !compatible || allIn(group.id),
      action: () => moveObjects(nodes, group.id),
    }));
    children.push({ label: text("未分组（移出文件夹）", "Ungrouped (move out)"), disabled: !compatible || allIn(null), action: () => moveObjects(nodes, null) });
    children.push({ label: "", separator: true });
    children.push({ label: text("新建文件夹并移入…", "Move into a new folder…"), icon: FolderPlus, disabled: !compatible, action: () => create(node, nodes) });
    return {
      label: nodes.length > 1 ? text(`移动 ${nodes.length} 个对象到虚拟文件夹`, `Move ${nodes.length} objects to virtual folder`) : text("移动到虚拟文件夹", "Move to virtual folder"),
      icon: FolderInput,
      children,
    };
  }

  function managementMenu(): ContextMenuItem[] {
    return [
      {
        label: text("撤销文件夹操作", "Undo folder action"),
        icon: Undo2,
        disabled: !sidebarVirtualGroupsCanUndo.value,
        action: () => {
          if (!undoSidebarVirtualGroups()) options.toast(failure(), 3500);
        },
      },
      {
        label: text("导出文件夹备份…", "Export folder backup…"),
        icon: Download,
        action: async () => {
          try {
            await saveTextFile(exportSidebarVirtualGroups(), `dbx-virtual-folders-${compactLocalTimestamp()}.json`, "JSON", "json");
          } catch (error) {
            options.toast(String(error), 3500);
          }
        },
      },
      {
        label: text("恢复文件夹备份…", "Restore folder backup…"),
        icon: Upload,
        action: () => {
          openSidebarVirtualGroupDialog({
            ...dialogLabels(),
            kind: "import",
            title: text("恢复虚拟文件夹备份", "Restore virtual folder backup"),
            fieldLabel: text("选择 JSON 文件或粘贴备份内容", "Choose a JSON file or paste its contents"),
            description: text(
              "将替换本机所有连接的虚拟文件夹布局。建议先导出当前备份；恢复后可撤销。连接标识必须与备份一致，不会导入数据库或连接密码。",
              "Replaces the virtual folder layout for all local connections. Export your current backup first; restore can be undone. Connection IDs must match the backup. Databases and passwords are not imported.",
            ),
            submitLabel: text("恢复备份", "Restore backup"),
            submit: (json) => {
              const result = importSidebarVirtualGroups(json);
              return result.success ? null : result.error || failure();
            },
          });
        },
      },
    ];
  }

  function folderMenu(node: TreeNode): ContextMenuItem[] {
    const id = sidebarVirtualGroupIdFromNode(node);
    const info = id ? sidebarVirtualGroupInfo(id) : null;
    if (!id || !info) return [];
    const descendants = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      for (const group of info.groups)
        if (group.parentId && descendants.has(group.parentId) && !descendants.has(group.id)) {
          descendants.add(group.id);
          added = true;
        }
    }
    const move = (parentId: string | null) => {
      if (!moveSidebarVirtualGroup(id, parentId)) options.toast(failure(), 3500);
    };
    const siblings = info.groups.filter((group) => (group.parentId ?? null) === (info.group.parentId ?? null));
    const siblingIndex = siblings.findIndex((group) => group.id === id);
    return [
      { label: text("新建子文件夹…", "New subfolder…"), icon: FolderPlus, action: () => create(node) },
      { label: text("重命名虚拟文件夹…", "Rename virtual folder…"), icon: Pencil, action: () => rename(node) },
      {
        label: text("移动文件夹到", "Move folder to"),
        icon: FolderInput,
        children: [
          { label: text("顶层", "Top level"), disabled: !info.group.parentId, action: () => move(null) },
          ...info.groups.filter((group) => !descendants.has(group.id)).map((group) => ({ label: sidebarVirtualGroupPath(group.id), disabled: info.group.parentId === group.id || !canMoveSidebarVirtualGroup(id, group.id), action: () => move(group.id) })),
        ],
      },
      {
        label: text("上移文件夹", "Move folder up"),
        icon: ArrowUp,
        disabled: siblingIndex <= 0,
        action: () => {
          if (!reorderSidebarVirtualGroup(id, "up")) options.toast(failure(), 3500);
        },
      },
      {
        label: text("下移文件夹", "Move folder down"),
        icon: ArrowDown,
        disabled: siblingIndex === siblings.length - 1,
        action: () => {
          if (!reorderSidebarVirtualGroup(id, "down")) options.toast(failure(), 3500);
        },
      },
      { label: text("删除虚拟文件夹…", "Delete virtual folder…"), icon: Trash2, variant: "destructive", action: () => remove(node) },
      { label: "", separator: true },
      ...managementMenu(),
    ];
  }

  function parentMenu(node: TreeNode): ContextMenuItem[] {
    const groups = sidebarVirtualGroupsForParent(node);
    return [
      { label: text("新建虚拟文件夹…", "New virtual folder…"), icon: FolderPlus, action: () => create(node) },
      {
        label: text("展开全部虚拟文件夹", "Expand all virtual folders"),
        icon: ChevronsDown,
        disabled: !groups.some((group) => !group.expanded),
        action: () => {
          if (!setSidebarVirtualGroupsExpanded(node, true)) options.toast(failure(), 3500);
        },
      },
      {
        label: text("折叠全部虚拟文件夹", "Collapse all virtual folders"),
        icon: ChevronsUp,
        disabled: !groups.some((group) => group.expanded),
        action: () => {
          if (!setSidebarVirtualGroupsExpanded(node, false)) options.toast(failure(), 3500);
        },
      },
      ...managementMenu(),
      { label: "", separator: true },
    ];
  }

  return { create, rename, remove, moveMenu, folderMenu, parentMenu };
}
