<script setup lang="ts">
  defineProps<{ title: string; testId?: string }>();
</script>

<template>
  <main class="mx-auto w-full max-w-7xl p-6" :data-testid="testId">
    <h1 class="text-2xl font-semibold text-foreground">{{ title }}</h1>
  </main>
</template>
