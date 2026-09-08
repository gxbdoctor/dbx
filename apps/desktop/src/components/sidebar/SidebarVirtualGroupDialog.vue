<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { closeSidebarVirtualGroupDialog, sidebarVirtualGroupDialog as request } from "@/lib/sidebar/sidebarVirtualGroupDialogs";

const value = ref("");
const error = ref("");
const reading = ref(false);
const open = computed({
  get: () => !!request.value,
  set: (next) => {
    if (!next) closeSidebarVirtualGroupDialog();
  },
});

watch(request, (next) => {
  value.value = next?.initialValue ?? "";
  error.value = "";
  reading.value = false;
});

onBeforeUnmount(closeSidebarVirtualGroupDialog);

function submit() {
  if (!request.value || reading.value) return;
  error.value = request.value.submit(value.value) ?? "";
  if (!error.value) closeSidebarVirtualGroupDialog();
}

async function readBackup(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const current = request.value;
  reading.value = true;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("JSON backup exceeds 10 MB / 备份超过 10 MB");
    const content = await file.text();
    if (request.value === current) value.value = content;
  } catch (cause) {
    if (request.value === current) error.value = String(cause);
  } finally {
    if (request.value === current) reading.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>{{ request?.title }}</DialogTitle>
        <DialogDescription class="whitespace-pre-line">{{ request?.description }}</DialogDescription>
      </DialogHeader>
      <form v-if="request" class="space-y-4" @submit.prevent="submit">
        <label v-if="request.kind === 'name'" class="block space-y-2 text-sm">
          <span>{{ request.fieldLabel }}</span>
          <Input v-model="value" autofocus maxlength="120" :aria-invalid="!!error" />
        </label>
        <div v-if="request.kind === 'import'" class="space-y-3">
          <input type="file" accept=".json,application/json" :aria-label="request.fieldLabel" @change="readBackup" />
          <label class="block space-y-2 text-sm">
            <span>{{ request.fieldLabel }}</span>
            <textarea v-model="value" class="h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs" :disabled="reading" :aria-invalid="!!error" />
          </label>
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="button" variant="outline" @click="closeSidebarVirtualGroupDialog">{{ request.cancelLabel }}</Button>
          <Button type="submit" :variant="request.destructive ? 'destructive' : 'default'" :disabled="reading || (request.kind !== 'confirm' && !value.trim())">{{ request.submitLabel }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
