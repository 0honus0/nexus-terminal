<script setup lang="ts">
  import { computed } from 'vue';
  import type { AgentSettingsViewDto } from '../api/agent-api';

  const props = defineProps<{ settings: AgentSettingsViewDto; busy: boolean }>();
  const emit = defineEmits<{ change: [enabled: boolean] }>();
  const runtimeEnabled = computed(() => ['enabled', 'degraded'].includes(props.settings.availability.state));
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.feature.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.feature.description') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
          :class="runtimeEnabled ? 'bg-success/15 text-success' : 'bg-text-secondary/15 text-text-secondary'"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="runtimeEnabled ? 'bg-success' : 'bg-text-secondary'"></span>
          {{ runtimeEnabled ? $t('agent.settings.enabled') : $t('agent.settings.disabled') }}
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium shadow-sm transition-all focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            runtimeEnabled
              ? 'border border-error/30 bg-error/10 text-error hover:bg-error/20'
              : 'bg-primary text-white hover:bg-primary/90'
          "
          :disabled="busy"
          @click="emit('change', !runtimeEnabled)"
        >
          {{ runtimeEnabled ? $t('agent.settings.feature.disable') : $t('agent.settings.feature.enable') }}
        </button>
      </div>
    </div>
    <div class="p-4 sm:p-5">
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 p-3.5 text-xs"
      >
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-circle-info text-xs text-primary" aria-hidden="true"></i>
          <span class="text-text-secondary">{{
            $t('agent.settings.feature.state', { state: settings.availability.state })
          }}</span>
        </div>
        <div class="text-[11px] text-text-secondary">调度器支持多应用委派与动态预算管控</div>
      </div>
    </div>
  </section>
</template>
