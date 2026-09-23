<script setup lang="ts">
  import { UiButton, UiInfoHint } from '@/foundation/ui';
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { AgentSettingsViewDto } from '../api/agent-api';

  const { t } = useI18n();
  const props = defineProps<{ settings: AgentSettingsViewDto; busy: boolean }>();
  const emit = defineEmits<{ change: [enabled: boolean] }>();
  const runtimeEnabled = computed(() => ['enabled', 'degraded'].includes(props.settings.availability.state));
  // The badge carries the real availability state, so it must not stay green for
  // 'enabling' / 'degraded'; the classes are written out for the Tailwind scanner.
  const stateBadgeClass = computed(() => {
    switch (props.settings.availability.state) {
      case 'enabled':
        return 'bg-success/15 text-success';
      case 'enabling':
      case 'degraded':
        return 'bg-warning/15 text-warning';
      default:
        return 'bg-text-secondary/15 text-text-secondary';
    }
  });
  const stateDotClass = computed(() => {
    switch (props.settings.availability.state) {
      case 'enabled':
        return 'bg-success';
      case 'enabling':
      case 'degraded':
        return 'bg-warning';
      default:
        return 'bg-text-secondary';
    }
  });

  // Long-form help lives behind the info marker: the card keeps one line of copy.
  const featureHelp = computed(
    () => `${t('agent.settings.feature.description')} ${t('agent.settings.feature.schedulerHint')}`,
  );
  const stateLabel = computed(() => {
    const key = `agent.settings.feature.stateLabels.${props.settings.availability.state}`;
    const translated = t(key);
    return translated === key ? props.settings.availability.state : translated;
  });
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div class="flex flex-wrap items-center justify-between gap-3 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5">
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.feature.title') }}</h3>
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
          :class="stateBadgeClass"
        >
          <span class="h-1.5 w-1.5 rounded-full" :class="stateDotClass"></span>
          {{ stateLabel }}
        </span>
        <UiInfoHint :text="featureHelp" />
      </div>
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
  </section>
</template>
