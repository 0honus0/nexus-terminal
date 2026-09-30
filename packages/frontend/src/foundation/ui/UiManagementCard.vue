<template>
  <article class="ui-solid-item ui-management-card">
    <div class="ui-management-card__body"><slot /></div>
    <div class="ui-management-card__actions"><slot name="actions" /></div>
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
  .ui-management-card__actions {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border-color);
  }
  @media (min-width: 640px) {
    .ui-management-card {
      flex-direction: row;
      align-items: center;
      gap: 24px;
      padding: 20px;
    }
    .ui-management-card__actions {
      flex-shrink: 0;
      padding-top: 0;
      border-top: 0;
    }
  }
</style>
