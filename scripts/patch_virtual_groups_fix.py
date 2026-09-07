from pathlib import Path

p = Path(__file__).resolve().parents[1] / "apps/desktop/src/lib/sidebar/sidebarVirtualGroups.ts"
text = p.read_text(encoding="utf-8")
old = 'export function supportsSidebarVirtualGroups(node: Pick<TreeNode, "type" | "connectionId" | "database">): node is Pick<TreeNode, "type" | "connectionId" | "database"> & { type: SidebarVirtualGroupParentType; connectionId: string; database: string } {'
new = 'export function supportsSidebarVirtualGroups(node: Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema">): node is Pick<TreeNode, "type" | "connectionId" | "database" | "catalog" | "schema"> & { type: SidebarVirtualGroupParentType; connectionId: string; database: string } {'
if text.count(old) != 1:
    raise RuntimeError(f"Expected one type-guard signature, got {text.count(old)}")
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Virtual Groups type guard fixed.")
