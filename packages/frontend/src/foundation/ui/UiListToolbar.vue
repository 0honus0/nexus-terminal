<script setup lang="ts">
  import UiInput from './UiInput.vue';
  const search = defineModel<string>({ default: '' });
  defineProps<{ searchLabel: string; placeholder?: string }>();
</script>
<template>
  <div class="ui-list-toolbar">
    <UiInput
      v-model="search"
      type="search"
      density="comfortable"
      :aria-label="searchLabel"
      :placeholder="placeholder || searchLabel"
    >
      <template #leading><i class="fa-solid fa-magnifying-glass text-xs" aria-hidden="true"></i></template>
    </UiInput>
    <div class="ui-list-toolbar__filters"><slot /></div>
  </div>
</template>
<style scoped>
  .ui-list-toolbar {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto;
    gap: 8px;
    margin: 8px;
    padding: 10px;
    border: 1px solid var(--ui-hairline);
    border-radius: 12px;
    background: color-mix(in srgb, var(--card-bg-color) 90%, var(--app-bg-color));
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%);
  }
  .ui-list-toolbar__filters {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  @media (max-width: 640px) {
    .ui-list-toolbar {
      grid-template-columns: minmax(0, 1fr);
    }
    .ui-list-toolbar__filters {
      flex-wrap: wrap;
      justify-content: space-between;
    }
  }
</style>
