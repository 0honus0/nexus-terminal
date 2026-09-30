<script setup lang="ts">
  import UiActionGroup from './UiActionGroup.vue';
</script>

<template>
  <article class="ui-solid-item ui-management-card">
    <div class="ui-management-card__body"><slot /></div>
    <UiActionGroup layout="management"><slot name="actions" /></UiActionGroup>
  </article>
</template>

<style scoped>
  .ui-management-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    border-radius: 14px;
    min-width: 0;
  }
  .ui-management-card__body {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  @media (min-width: 640px) {
    .ui-management-card {
      flex-direction: row;
      align-items: center;
      gap: 24px;
      padding: 20px;
    }
  }
</style>
