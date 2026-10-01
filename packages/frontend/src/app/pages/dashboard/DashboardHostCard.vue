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
      compact?: boolean;
    }>(),
    {
      as: 'div',
      titleTag: 'h3',
      address: undefined,
      type: undefined,
      statusDotClass: undefined,
      accentClass: undefined,
      compact: false,
    },
  );

  const slots = useSlots();
  const hasAction = computed(() => Boolean(slots.action));
  const hasAccent = computed(() => Boolean(props.accentClass));
</script>

<template>
  <component
    :is="as"
    class="dashboard-host-card group relative overflow-hidden rounded-lg p-3 sm:px-4 sm:py-3.5"
    :class="{ 'pl-3.5 sm:pl-4.5': hasAccent, 'dashboard-host-card--compact': compact }"
  >
    <span
      v-if="accentClass"
      class="absolute inset-y-2 left-0 w-0.5 transition-colors sm:inset-y-2.5"
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
          <div class="dashboard-host-card__identity flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <div class="flex min-w-0 items-baseline gap-2">
              <slot name="status-dot">
                <span
                  v-if="statusDotClass"
                  class="h-2 w-2 shrink-0 self-center rounded-full"
                  :class="statusDotClass"
                  aria-hidden="true"
                ></span>
              </slot>
              <component
                :is="titleTag"
                class="dashboard-host-card__name truncate text-lg font-semibold tracking-tight text-foreground"
                :title="name"
              >
                {{ name }}
              </component>
            </div>
            <span
              v-if="address"
              class="dashboard-host-card__address relative -translate-y-[2.5px] truncate font-mono text-[13px] text-text-secondary"
              :title="address"
            >
              {{ address }}
            </span>
            <span
              v-if="type"
              class="relative translate-y-[1.5px] self-center rounded-full border border-border/60 bg-card/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary"
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

<style scoped>
  .dashboard-host-card {
    border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
    background: color-mix(in srgb, var(--card-bg-color) 82%, var(--app-bg-color));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
      0 5px 14px -12px color-mix(in srgb, var(--text-color) 32%, transparent);
    transition:
      border-color 140ms ease,
      background-color 140ms ease;
  }

  .dashboard-host-card:hover {
    border-color: color-mix(in srgb, var(--border-color) 64%, var(--link-active-color));
    background: color-mix(in srgb, var(--card-bg-color) 90%, var(--app-bg-color));
  }
  .dashboard-host-card--compact {
    padding: 12px;
  }
  .dashboard-host-card--compact > div {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
  }
  .dashboard-host-card--compact > div > :last-child {
    width: auto;
  }
  .dashboard-host-card--compact .dashboard-host-card__name {
    font-size: 14px;
  }
  .dashboard-host-card--compact .dashboard-host-card__identity {
    gap: 4px 8px;
  }
  .dashboard-host-card--compact .dashboard-host-card__address {
    width: 100%;
    order: 1;
    font-size: 12px;
    transform: none;
  }
</style>
