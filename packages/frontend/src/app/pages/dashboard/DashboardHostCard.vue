<script setup lang="ts">
  import { computed, useSlots } from 'vue';

  const props = withDefaults(
    defineProps<{
      as?: string;
      titleTag?: string;
      name: string;
      address?: string;
      type?: string;
      statusDotClass?: string;
      accentClass?: string;
    }>(),
    {
      as: 'div',
      titleTag: 'h3',
      address: undefined,
      type: undefined,
      statusDotClass: undefined,
      accentClass: undefined,
    },
  );

  const slots = useSlots();
  const hasAction = computed(() => Boolean(slots.action));
  const hasAccent = computed(() => Boolean(props.accentClass));
</script>

<template>
  <component
    :is="as"
    class="group relative overflow-hidden rounded-lg border border-border/60 bg-header/20 px-4 py-3.5 backdrop-blur-xs transition-colors hover:bg-header/35"
    :class="{ 'pl-4.5': hasAccent }"
  >
    <span
      v-if="accentClass"
      class="absolute inset-y-0 left-0 w-1 transition-colors"
      :class="accentClass"
      aria-hidden="true"
    ></span>

    <div
      :class="[
        hasAction ? 'grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5' : 'min-w-0',
      ]"
    >
      <div class="min-w-0">
        <slot name="header">
          <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <div class="flex min-w-0 items-center gap-2">
              <slot name="status-dot">
                <span
                  v-if="statusDotClass"
                  class="h-2 w-2 shrink-0 rounded-full"
                  :class="statusDotClass"
                  aria-hidden="true"
                ></span>
              </slot>
              <component
                :is="titleTag"
                class="truncate text-lg font-semibold tracking-tight text-foreground"
                :title="name"
              >
                {{ name }}
              </component>
            </div>
            <span v-if="address" class="truncate font-mono text-[13px] text-text-secondary" :title="address">
              {{ address }}
            </span>
            <span
              v-if="type"
              class="rounded border border-border/70 bg-header/50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary"
            >
              {{ type }}
            </span>
            <slot name="identity-extra"></slot>
          </div>
          <slot name="metadata"></slot>
        </slot>
      </div>

      <div v-if="hasAction" class="w-full shrink-0 sm:w-auto">
        <slot name="action"></slot>
      </div>
    </div>

    <slot></slot>
  </component>
</template>
