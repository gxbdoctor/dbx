import { shallowRef } from "vue";

export interface SidebarVirtualGroupDialogRequest {
  title: string;
  description: string;
  kind: "name" | "confirm" | "import";
  initialValue?: string;
  submitLabel: string;
  cancelLabel: string;
  fieldLabel: string;
  destructive?: boolean;
  submit: (value: string) => string | null;
}

// One dialog belongs to the tree runtime, never to a recycled row. Requests
// capture their target before opening so a selection change cannot redirect it.
export const sidebarVirtualGroupDialog = shallowRef<SidebarVirtualGroupDialogRequest | null>(null);

export function openSidebarVirtualGroupDialog(request: SidebarVirtualGroupDialogRequest) {
  sidebarVirtualGroupDialog.value = request;
}

export function closeSidebarVirtualGroupDialog() {
  sidebarVirtualGroupDialog.value = null;
}
