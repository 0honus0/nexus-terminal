<script setup lang="ts">
  import { UiInput } from '@/foundation/ui';
  const search = defineModel<string>({ default: '' });
  defineProps<{ placeholder: string }>();
</script>

<template>
  <div class="min-w-0 space-y-3">
    <slot name="selection" />
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <UiInput
        v-model="search"
        type="search"
        class="min-w-0 flex-1"
        :placeholder="placeholder"
        :aria-label="placeholder"
      >
        <template #leading><i class="fa-solid fa-magnifying-glass"></i></template>
      </UiInput>
      <slot />
    </div>
  </div>
</template>
