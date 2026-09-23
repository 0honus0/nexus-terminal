<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    type AgentAppSummaryDto,
    type AgentExecutionPolicyOverridesDto,
    type AgentExecutionPolicyViewDto,
  } from '../api/agent-api';
  import QuantityInput from './QuantityInput.vue';
  import { formatQuantity, type QuantityType } from './quantity-format';

  const props = defineProps<{ apps: AgentAppSummaryDto[]; busy: boolean }>();
  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.execution-policy');
  const selectedAppId = ref('');
  const view = ref<AgentExecutionPolicyViewDto | null>(null);
  const draft = ref<AgentExecutionPolicyOverridesDto>({});
  const loading = ref(false);
  const saving = ref(false);

  type NumericKey = Exclude<keyof AgentExecutionPolicyOverridesDto, 'contextCompactionMode' | 'contextProfile'>;
  interface FieldMeta {
    key: NumericKey;
    type: QuantityType;
  }
  const fields: FieldMeta[] = [
    { key: 'maxRunSteps', type: 'number' },
    { key: 'maxActiveExecutionSeconds', type: 'seconds' },
    { key: 'toolTimeoutSeconds', type: 'seconds' },
    { key: 'maxToolOutputBytes', type: 'bytes' },
    { key: 'maxRecallItems', type: 'number' },
    { key: 'maxRecallBytes', type: 'bytes' },
    { key: 'maxSubagentMessages', type: 'number' },
    { key: 'maxSubagentMessageBytes', type: 'bytes' },
  ];

  const clone = (value: AgentExecutionPolicyOverridesDto): AgentExecutionPolicyOverridesDto =>
    JSON.parse(JSON.stringify(value)) as AgentExecutionPolicyOverridesDto;

  const load = async (): Promise<void> => {
    if (!selectedAppId.value) {
      view.value = null;
      draft.value = {};
      return;
    }
    loading.value = true;
    try {
      const next = await agentApi.appExecutionPolicy(selectedAppId.value);
      view.value = next;
      draft.value = clone(next.overrides);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'AGENT_EXECUTION_POLICY_FAILED';
      operationFeedback.notifyError({ operation: 'load-policy', message, cause });
    } finally {
      loading.value = false;
    }
  };

  watch(
    () => props.apps.map((app) => app.id).join('\u0000'),
    () => {
      if (!props.apps.some((app) => app.id === selectedAppId.value)) selectedAppId.value = props.apps[0]?.id ?? '';
    },
    { immediate: true },
  );
  watch(selectedAppId, load, { immediate: true });

  const hasOverride = (key: keyof AgentExecutionPolicyOverridesDto): boolean =>
    Object.prototype.hasOwnProperty.call(draft.value, key);

  const toggleOverride = (key: keyof AgentExecutionPolicyOverridesDto, enabled: boolean): void => {
    if (!view.value) return;
    if (!enabled) {
      const next = { ...draft.value };
      delete next[key];
      draft.value = next;
      return;
    }
    draft.value = { ...draft.value, [key]: view.value.effective[key] };
  };

  const effectiveValue = (field: FieldMeta): string => {
    if (!view.value) return '—';
    const value = view.value.effective[field.key];
    if (value === null) return '∞';
    return formatQuantity(value, field.type);
  };

  const invalid = computed(() =>
    fields.some(({ key }) => {
      if (!hasOverride(key)) return false;
      const value = draft.value[key];
      return typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1;
    }),
  );

  const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(view.value?.overrides ?? {}));

  const save = async (): Promise<void> => {
    if (!view.value || !selectedAppId.value || invalid.value || saving.value) return;
    saving.value = true;
    try {
      const next = await agentApi.replaceAppExecutionPolicy(selectedAppId.value, draft.value, view.value.version);
      view.value = next;
      draft.value = clone(next.overrides);
      operationFeedback.notifySuccess(t('agent.ui.saved'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'AGENT_EXECUTION_POLICY_FAILED';
      operationFeedback.notifyError({ operation: 'save-policy', message, cause });
      await load();
    } finally {
      saving.value = false;
    }
  };
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.executionPolicy.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.executionPolicy.description') }}</p>
      </div>
      <label class="min-w-52">
        <span class="sr-only">{{ $t('agent.settings.executionPolicy.app') }}</span>
        <select v-model="selectedAppId" class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
          <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.displayName }}</option>
        </select>
      </label>
    </div>

    <div class="space-y-4 p-4 sm:p-5">
      <div v-if="view && !loading" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div v-for="field in fields" :key="field.key" class="rounded-lg border border-border/60 bg-background/60 p-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-xs font-medium text-foreground">
                {{ $t(`agent.settings.executionPolicy.fields.${field.key}`) }}
              </div>
              <div class="mt-0.5 text-[11px] text-text-secondary">
                {{ $t('agent.settings.executionPolicy.effective', { value: effectiveValue(field) }) }}
              </div>
            </div>
            <label class="flex items-center gap-1 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                :checked="hasOverride(field.key)"
                :disabled="busy || saving"
                @change="toggleOverride(field.key, ($event.target as HTMLInputElement).checked)"
              />
              {{ $t('agent.settings.executionPolicy.override') }}
            </label>
          </div>
          <QuantityInput
            v-if="hasOverride(field.key)"
            v-model="draft[field.key]"
            class="mt-2"
            :type="field.type"
            :min="1"
            :disabled="busy || saving"
          />
          <div v-else class="mt-2 rounded-md bg-header/50 px-2 py-2 text-[11px] text-text-secondary">
            {{ $t('agent.settings.executionPolicy.inherited') }}
          </div>
        </div>

        <div class="rounded-lg border border-border/60 bg-background/60 p-3 md:col-span-2 xl:col-span-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-xs font-medium text-foreground">
                {{ $t('agent.settings.executionPolicy.fields.contextProfile') }}
              </div>
              <div class="mt-0.5 text-[11px] text-text-secondary">
                {{ $t('agent.settings.executionPolicy.profileHint') }}
              </div>
            </div>
            <label class="flex items-center gap-1 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                :checked="hasOverride('contextProfile')"
                :disabled="busy || saving"
                @change="toggleOverride('contextProfile', ($event.target as HTMLInputElement).checked)"
              />
              {{ $t('agent.settings.executionPolicy.override') }}
            </label>
          </div>
          <select
            v-if="hasOverride('contextProfile')"
            v-model="draft.contextProfile"
            class="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            :disabled="busy || saving"
          >
            <option value="normal">{{ $t('agent.settings.executionPolicy.profile.normal') }}</option>
            <option value="extended">{{ $t('agent.settings.executionPolicy.profile.extended') }}</option>
          </select>
          <div v-else class="mt-2 text-[11px] text-text-secondary">
            {{ $t('agent.settings.executionPolicy.profileInherited', { value: view.effective.contextProfile }) }}
          </div>
        </div>

        <div class="rounded-lg border border-border/60 bg-background/60 p-3 md:col-span-2 xl:col-span-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-xs font-medium text-foreground">
                {{ $t('agent.settings.executionPolicy.fields.contextCompactionMode') }}
              </div>
              <div class="mt-0.5 text-[11px] text-text-secondary">
                {{ $t('agent.settings.executionPolicy.compactionHint') }}
              </div>
            </div>
            <label class="flex items-center gap-1 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                :checked="hasOverride('contextCompactionMode')"
                :disabled="busy || saving"
                @change="toggleOverride('contextCompactionMode', ($event.target as HTMLInputElement).checked)"
              />
              {{ $t('agent.settings.executionPolicy.override') }}
            </label>
          </div>
          <select
            v-if="hasOverride('contextCompactionMode')"
            v-model="draft.contextCompactionMode"
            class="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            :disabled="busy || saving"
          >
            <option value="aggressive">{{ $t('agent.settings.executionPolicy.compaction.aggressive') }}</option>
            <option value="balanced">{{ $t('agent.settings.executionPolicy.compaction.balanced') }}</option>
            <option value="conservative">{{ $t('agent.settings.executionPolicy.compaction.conservative') }}</option>
          </select>
          <div v-else class="mt-2 text-[11px] text-text-secondary">
            {{
              $t('agent.settings.executionPolicy.compactionInherited', { value: view.effective.contextCompactionMode })
            }}
          </div>
        </div>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="busy || saving || loading || invalid || !dirty"
          @click="save"
        >
          {{ $t('common.save') }}
        </button>
      </div>
    </div>
  </section>
</template>
