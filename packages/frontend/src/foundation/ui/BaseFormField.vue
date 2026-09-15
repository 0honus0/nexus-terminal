<script setup lang="ts">
  defineProps<{
    label?: string;
    description?: string;
    error?: string;
    required?: boolean;
    forId?: string;
  }>();
</script>

<template>
  <div class="space-y-2">
    <label
      v-if="label"
      :for="forId"
      class="relative z-1 block text-sm font-medium leading-normal text-text-secondary pb-0.5"
    >
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-error">*</span>
    </label>
    <slot />
    <p v-if="error" class="text-xs text-error" role="alert">{{ error }}</p>
    <p v-else-if="description" class="text-xs text-text-secondary">{{ description }}</p>
  </div>
</template>
