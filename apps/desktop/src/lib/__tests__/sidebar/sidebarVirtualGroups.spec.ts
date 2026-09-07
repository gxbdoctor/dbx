import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "@/types/database";
import { applySidebarVirtualGroups, createSidebarVirtualGroup, deleteSidebarVirtualGroup, moveSidebarObjectToVirtualGroup, renameSidebarVirtualGroup, resetSidebarVirtualGroupsForTests, sidebarVirtualGroupsForObject } from "@/lib/sidebar/sidebarVirtualGroups";

const storage = new Map<string, string>();

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
});
