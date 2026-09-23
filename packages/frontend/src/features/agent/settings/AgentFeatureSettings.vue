<script setup lang="ts">
  import { UiButton } from '@/foundation/ui';
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { AgentSettingsViewDto } from '../api/agent-api';

  const { t } = useI18n();
  const props = defineProps<{ settings: AgentSettingsViewDto; busy: boolean }>();
  const emit = defineEmits<{ change: [enabled: boolean] }>();
  const runtimeEnabled = computed(() => ['enabled', 'degraded'].includes(props.settings.availability.state));
  const stateLabel = computed(() => {
    const key = `agent.settings.feature.stateLabels.${props.settings.availability.state}`;
    const translated = t(key);
    return translated === key ? props.settings.availability.state : translated;
  });
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
        <UiButton
          type="button"
          :appearance="runtimeEnabled ? 'soft' : 'solid'"
          :tone="runtimeEnabled ? 'danger' : 'primary'"
          :disabled="busy"
          @click="emit('change', !runtimeEnabled)"
        >
          {{ runtimeEnabled ? $t('agent.settings.feature.disable') : $t('agent.settings.feature.enable') }}
        </UiButton>
      </div>
    </div>
    <div class="p-4 sm:p-5">
      <div
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 p-3.5 text-xs"
      >
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-circle-info text-xs text-primary" aria-hidden="true"></i>
          <span class="text-text-secondary">{{ $t('agent.settings.feature.state', { state: stateLabel }) }}</span>
        </div>
        <div class="text-[11px] text-text-secondary">{{ $t('agent.settings.feature.schedulerHint') }}</div>
      </div>
    </div>
  </section>
</template>
