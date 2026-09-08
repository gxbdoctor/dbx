// @vitest-environment happy-dom
import { createApp, h, nextTick, type App } from "vue";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarVirtualGroupActions } from "../useSidebarVirtualGroupActions";
import SidebarVirtualGroupDialog from "@/components/sidebar/SidebarVirtualGroupDialog.vue";
import { sidebarVirtualGroupDialog, closeSidebarVirtualGroupDialog } from "@/lib/sidebar/sidebarVirtualGroupDialogs";
import { createSidebarVirtualGroup, applySidebarVirtualGroups, resetSidebarVirtualGroupsForTests, sidebarVirtualGroupsForObject, sidebarVirtualGroupsForParent, exportSidebarVirtualGroups } from "@/lib/sidebar/sidebarVirtualGroups";
import type { TreeNode } from "@/types/database";

const parent: TreeNode = { id: "views", label: "物化视图", type: "group-materialized-views", connectionId: "c", database: "db", schema: "s", children: [], isExpanded: true };
const object = (name: string): TreeNode => ({ ...parent, id: name, label: name, type: "materialized_view" });
let app: App;
let actions: ReturnType<typeof useSidebarVirtualGroupActions>;
let active: TreeNode;
let selected: TreeNode[];

async function flush() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

beforeEach(async () => {
  localStorage.clear();
  resetSidebarVirtualGroupsForTests();
  closeSidebarVirtualGroupDialog();
  active = object("one");
  selected = [active];
  const container = document.createElement("div");
  document.body.append(container);
  app = createApp({
    setup() {
      actions = useSidebarVirtualGroupActions({ activeNode: () => active, selectedNodes: () => selected, toast: vi.fn() });
      return () => h(SidebarVirtualGroupDialog);
    },
  });
  app.use(createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": {} } }));
  app.mount(container);
  await flush();
});

afterEach(() => {
  closeSidebarVirtualGroupDialog();
  app.unmount();
  document.body.innerHTML = "";
});

describe("virtual folder UI actions", () => {
  it("moves the captured multi-selection even if selection changes while the menu is open", () => {
    const two = object("two");
    selected = [active, two];
    const folder = createSidebarVirtualGroup(parent, "研究")!;
    const menu = actions.moveMenu(active);
    expect(menu.label).toContain("2");
    selected = [object("unrelated")];
    menu.children![0].action!();
    expect(sidebarVirtualGroupsForObject(active).currentGroupId).toBe(folder.id);
    expect(sidebarVirtualGroupsForObject(two).currentGroupId).toBe(folder.id);
    expect(sidebarVirtualGroupsForObject(selected[0]).currentGroupId).toBeNull();
  });

  it("disables moving a mixed-scope selection instead of silently moving a subset", () => {
    createSidebarVirtualGroup(parent, "研究");
    selected = [active, { ...object("other"), schema: "elsewhere" }];
    const menu = actions.moveMenu(active);
    expect(menu.children!.filter((item) => !item.separator).every((item) => item.disabled)).toBe(true);
  });

  it("submits a real in-app form and leaves duplicate-name errors visible", async () => {
    createSidebarVirtualGroup(parent, "已有");
    actions.create(parent);
    await flush();
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    expect(input).not.toBeNull();
    input.value = "已有";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("同级重名");
    input.value = "新建";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(sidebarVirtualGroupsForParent(parent).map((folder) => folder.name)).toEqual(["已有", "新建"]);
    expect(sidebarVirtualGroupDialog.value).toBeNull();
  });

  it("cancelled deletion and rejected import preserve all folder data", async () => {
    const group = createSidebarVirtualGroup(parent, "保留")!;
    const folderNode = applySidebarVirtualGroups([parent])[0].children![0];
    const before = exportSidebarVirtualGroups();
    actions.remove(folderNode);
    await flush();
    const cancel = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "取消")!;
    cancel.click();
    await flush();
    expect(sidebarVirtualGroupDialog.value).toBeNull();
    expect(exportSidebarVirtualGroups()).toBe(before);
    const restore = actions.folderMenu(folderNode).find((item) => item.label.includes("恢复"))!;
    restore.action!();
    expect(sidebarVirtualGroupDialog.value!.submit('{"version":99}')).toBeTruthy();
    expect(sidebarVirtualGroupsForParent(parent)[0].id).toBe(group.id);
    expect(exportSidebarVirtualGroups()).toBe(before);
  });
});
