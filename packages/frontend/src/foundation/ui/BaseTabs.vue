<script setup lang="ts" generic="T extends string">
  const model = defineModel<T>({ required: true });
  defineProps<{
    items: readonly { value: T; label: string; disabled?: boolean; testId?: string }[];
    ariaLabel?: string;
  }>();
</script>

<template>
  <div class="border-b border-border">
    <div class="flex min-w-0 gap-1 overflow-x-auto" role="tablist" :aria-label="ariaLabel">
      <button
        v-for="item in items"
        :key="item.value"
        type="button"
        role="tab"
        :aria-selected="model === item.value"
        :disabled="item.disabled"
        :data-testid="item.testId"
        class="shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        :class="
          model === item.value
            ? 'border-link-active text-link-active'
            : 'border-transparent text-text-secondary hover:text-foreground'
        "
        @click="model = item.value"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
