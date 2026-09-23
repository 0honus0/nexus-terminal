<script setup lang="ts">
  withDefaults(
    defineProps<{
      icon?: string;
      title?: string;
      description?: string;
      dense?: boolean;
      bordered?: boolean;
    }>(),
    { icon: 'fa-solid fa-inbox', title: '', description: '', dense: false, bordered: true },
  );
</script>

<template>
  <div
    data-ui="empty-state"
    data-ui-gen="2"
    class="ui-empty-state"
    :data-dense="dense ? 'true' : 'false'"
    :data-bordered="bordered ? 'true' : 'false'"
  >
    <span class="ui-empty-state__icon"><i :class="icon" aria-hidden="true"></i></span>
    <div class="ui-empty-state__body">
      <p v-if="title" class="ui-empty-state__title">{{ title }}</p>
      <p v-if="description" class="ui-empty-state__description">{{ description }}</p>
    </div>
    <div v-if="$slots.action" class="ui-empty-state__action"><slot name="action" /></div>
  </div>
</template>
