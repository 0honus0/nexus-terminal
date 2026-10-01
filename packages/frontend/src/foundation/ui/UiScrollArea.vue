<script setup lang="ts">
  import { ref } from 'vue';
  import UiButton from './UiButton.vue';

  defineProps<{ backToTopLabel: string }>();
  const viewport = ref<HTMLElement | null>(null);
  const scrolled = ref(false);
  const updateScroll = () => {
    scrolled.value = (viewport.value?.scrollTop ?? 0) > 100;
  };
  const backToTop = () =>
    viewport.value?.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
</script>

<template>
  <div class="ui-scroll-area">
    <div ref="viewport" class="ui-scroll-area__viewport" @scroll.passive="updateScroll"><slot /></div>
    <UiButton
      v-if="scrolled"
      class="ui-scroll-area__back"
      appearance="soft"
      tone="neutral"
      icon-only
      :aria-label="backToTopLabel"
      :title="backToTopLabel"
      @click="backToTop"
    >
      <i class="fas fa-arrow-up" aria-hidden="true" />
    </UiButton>
  </div>
</template>

<style scoped>
  .ui-scroll-area {
    position: relative;
    min-height: 0;
  }
  .ui-scroll-area__viewport {
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: auto;
    scrollbar-gutter: stable;
  }
  .ui-scroll-area__back {
    position: absolute;
    right: 12px;
    bottom: 12px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--border-color) 75%, var(--link-active-color));
    background: color-mix(in srgb, var(--card-bg-color) 86%, var(--link-active-color));
    color: var(--text-color);
    box-shadow: 0 3px 12px rgb(0 0 0 / 16%);
  }
  .ui-scroll-area__back:hover {
    background: color-mix(in srgb, var(--card-bg-color) 78%, var(--link-active-color));
  }
</style>
