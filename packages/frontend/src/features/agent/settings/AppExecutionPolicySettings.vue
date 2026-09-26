<script setup lang="ts">
  import { structurallyEqual } from '@/foundation/data';
  import { UiButton, UiCheckbox, UiInfoHint, UiSelect } from '@/foundation/ui';
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppSummaryDto,
    type AgentExecutionPolicyOverridesDto,
    type AgentExecutionPolicyViewDto,
  } from '../api/agent-api';
  import QuantityInput from './QuantityInput.vue';
  import { formatQuantity, type QuantityType } from './quantity-format';
  import { useQuantityLabels } from './use-quantity-labels';

  const props = defineProps<{ apps: AgentAppSummaryDto[]; busy: boolean }>();
  const { t } = useI18n();
  const quantityLabels = useQuantityLabels();
  const operationFeedback = useOperationFeedback('agent.settings.execution-policy');
  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.operations.requestFailed'), t);
  const selectedAppId = ref('');
  const view = ref<AgentExecutionPolicyViewDto | null>(null);
  const draft = ref<AgentExecutionPolicyOverridesDto>({});
  const loading = ref(false);
  const saving = ref(false);
  const loadedAppId = ref('');
  let loadGeneration = 0;

  const appOptions = computed(() => props.apps.map((app) => ({ value: app.id, label: app.displayName })));

  const selectProfile = (value: 'normal' | 'extended'): void => {
    if (props.busy || saving.value) return;
    if (!hasOverride('contextProfile')) {
      toggleOverride('contextProfile', true);
    }
    draft.value = { ...draft.value, contextProfile: value };
  };

  const selectCompaction = (value: 'aggressive' | 'balanced' | 'conservative'): void => {
    if (props.busy || saving.value) return;
    if (!hasOverride('contextCompactionMode')) {
      toggleOverride('contextCompactionMode', true);
    }
    draft.value = { ...draft.value, contextCompactionMode: value };
  };

  const currentProfile = computed<'normal' | 'extended'>(() => {
    if (hasOverride('contextProfile')) {
      return draft.value.contextProfile ?? view.value?.effective.contextProfile ?? 'normal';
    }
    return view.value?.effective.contextProfile ?? 'normal';
  });

  const currentCompaction = computed<'aggressive' | 'balanced' | 'conservative'>(() => {
    if (hasOverride('contextCompactionMode')) {
      return draft.value.contextCompactionMode ?? view.value?.effective.contextCompactionMode ?? 'balanced';
    }
    return view.value?.effective.contextCompactionMode ?? 'balanced';
  });

  interface ProfileOption {
    value: 'normal' | 'extended';
    label: string;
    description: string;
    icon: string;
  }

  const profileOptions = computed<ProfileOption[]>(() => [
    {
      value: 'normal',
      label: t('agent.settings.executionPolicy.profile.normal'),
      description: t('agent.settings.executionPolicy.profileDesc.normal'),
      icon: 'fa-solid fa-shield-halved',
    },
    {
      value: 'extended',
      label: t('agent.settings.executionPolicy.profile.extended'),
      description: t('agent.settings.executionPolicy.profileDesc.extended'),
      icon: 'fa-solid fa-arrows-maximize',
    },
  ]);

  interface CompactionOption {
    value: 'aggressive' | 'balanced' | 'conservative';
    label: string;
    description: string;
    icon: string;
  }

  const compactionOptions = computed<CompactionOption[]>(() => [
    {
      value: 'aggressive',
      label: t('agent.settings.executionPolicy.compaction.aggressive'),
      description: t('agent.settings.executionPolicy.compactionDesc.aggressive'),
      icon: 'fa-solid fa-bolt',
    },
    {
      value: 'balanced',
      label: t('agent.settings.executionPolicy.compaction.balanced'),
      description: t('agent.settings.executionPolicy.compactionDesc.balanced'),
      icon: 'fa-solid fa-scale-balanced',
    },
    {
      value: 'conservative',
      label: t('agent.settings.executionPolicy.compaction.conservative'),
      description: t('agent.settings.executionPolicy.compactionDesc.conservative'),
      icon: 'fa-solid fa-box-archive',
    },
  ]);

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
    const requestGeneration = ++loadGeneration;
    const appId = selectedAppId.value;
    if (!appId) {
      loadedAppId.value = '';
      view.value = null;
      draft.value = {};
      loading.value = false;
      return;
    }
    if (loadedAppId.value !== appId) {
      loadedAppId.value = '';
      view.value = null;
      draft.value = {};
    }
    loading.value = true;
    try {
      const next = await agentApi.appExecutionPolicy(appId);
      if (requestGeneration !== loadGeneration || selectedAppId.value !== appId) return;
      loadedAppId.value = appId;
      view.value = next;
      draft.value = clone(next.overrides);
    } catch (cause) {
      if (requestGeneration !== loadGeneration || selectedAppId.value !== appId) return;
      const message = explain(cause);
      operationFeedback.notifyError({ operation: 'load-policy', message, cause });
    } finally {
      if (requestGeneration === loadGeneration && selectedAppId.value === appId) loading.value = false;
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
    return formatQuantity(value, field.type, quantityLabels.value);
  };

  const invalid = computed(() =>
    fields.some(({ key }) => {
      if (!hasOverride(key)) return false;
      const value = draft.value[key];
      return typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1;
    }),
  );

  const dirty = computed(() => !structurallyEqual(draft.value, view.value?.overrides ?? {}));

  const save = async (): Promise<void> => {
    const appId = loadedAppId.value;
    if (!view.value || !appId || selectedAppId.value !== appId || invalid.value || saving.value) return;
    const requestGeneration = loadGeneration;
    const overrides = clone(draft.value);
    const expectedVersion = view.value.version;
    saving.value = true;
    try {
      const next = await agentApi.replaceAppExecutionPolicy(appId, overrides, expectedVersion);
      if (requestGeneration !== loadGeneration || selectedAppId.value !== appId || loadedAppId.value !== appId) return;
      view.value = next;
      draft.value = clone(next.overrides);
      operationFeedback.notifySuccess(t('agent.ui.saved'));
    } catch (cause) {
      if (requestGeneration !== loadGeneration || selectedAppId.value !== appId || loadedAppId.value !== appId) return;
      const message = explain(cause);
      operationFeedback.notifyError({ operation: 'save-policy', message, cause });
      await load();
    } finally {
      saving.value = false;
    }
  };
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3 sm:px-5 agent-settings-head"
    >
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.executionPolicy.title') }}</h3>
        <UiInfoHint :text="$t('agent.settings.executionPolicy.description')" />
      </div>
      <label class="min-w-52">
        <span class="sr-only">{{ $t('agent.settings.executionPolicy.app') }}</span>
        <UiSelect
          v-model="selectedAppId"
          class="w-full"
          :options="appOptions"
          :aria-label="$t('agent.settings.executionPolicy.app')"
        />
      </label>
    </div>

    <div class="space-y-4 p-4 sm:p-5">
      <div v-if="view && !loading" class="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="field in fields"
          :key="field.key"
          class="rounded-xl border border-border/70 bg-card/45 p-3.5 shadow-2xs"
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-xs font-semibold text-foreground">
                {{ $t(`agent.settings.executionPolicy.fields.${field.key}`) }}
              </div>
              <div class="mt-0.5 text-[11px] text-text-secondary">
                {{ $t('agent.settings.executionPolicy.effective', { value: effectiveValue(field) }) }}
              </div>
            </div>
            <label class="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none">
              <UiCheckbox
                :model-value="hasOverride(field.key)"
                :disabled="busy || saving"
                @update:model-value="(value: boolean) => toggleOverride(field.key, value)"
              />
              <span>{{ $t('agent.settings.executionPolicy.override') }}</span>
            </label>
          </div>
          <QuantityInput
            v-if="hasOverride(field.key)"
            v-model="draft[field.key]"
            class="mt-2.5"
            :type="field.type"
            :min="1"
            :disabled="busy || saving"
          />
          <div
            v-else
            class="mt-2.5 flex items-center gap-1.5 rounded-lg border border-border/50 bg-header/30 px-2.5 py-1.5 text-[11px] text-text-secondary"
          >
            <i class="fa-solid fa-link text-[9px] text-text-secondary/70" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.executionPolicy.inherited') }}</span>
          </div>
        </div>

        <!-- 上下文窗口策略 -->
        <div
          class="rounded-xl border border-border/70 bg-header/20 p-4 sm:p-5 shadow-2xs md:col-span-2 xl:col-span-3 transition-all"
        >
          <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <i class="fa-solid fa-arrows-split-up-and-left text-xs" aria-hidden="true"></i>
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h4 class="text-xs font-semibold text-foreground">
                    {{ $t('agent.settings.executionPolicy.fields.contextProfile') }}
                  </h4>
                  <span
                    v-if="hasOverride('contextProfile')"
                    class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                  >
                    <i class="fa-solid fa-pen-to-square text-[9px]" aria-hidden="true"></i>
                    {{ $t('agent.settings.executionPolicy.customOverride') }}
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/60 px-2 py-0.5 text-[10px] text-text-secondary"
                  >
                    <i class="fa-solid fa-link text-[9px] text-text-secondary/70" aria-hidden="true"></i>
                    {{
                      $t('agent.settings.executionPolicy.profileInherited', { value: view.effective.contextProfile })
                    }}
                  </span>
                </div>
                <p class="mt-0.5 text-[11px] text-text-secondary leading-relaxed">
                  {{ $t('agent.settings.executionPolicy.profileHint') }}
                </p>
              </div>
            </div>

            <label
              class="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-text-secondary hover:border-border hover:bg-card cursor-pointer transition-all select-none"
            >
              <UiCheckbox
                :model-value="hasOverride('contextProfile')"
                :disabled="busy || saving"
                @update:model-value="(value: boolean) => toggleOverride('contextProfile', value)"
              />
              <span :class="hasOverride('contextProfile') ? 'font-medium text-foreground' : 'text-text-secondary'">
                {{ $t('agent.settings.executionPolicy.override') }}
              </span>
            </label>
          </div>

          <!-- 选项卡片 (2列) -->
          <div class="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              v-for="opt in profileOptions"
              :key="opt.value"
              type="button"
              :disabled="busy || saving"
              class="group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer focus:outline-none"
              :class="
                currentProfile === opt.value
                  ? hasOverride('contextProfile')
                    ? 'border-primary bg-primary/10 shadow-2xs ring-1 ring-primary/25'
                    : 'border-border/90 bg-header/40 ring-1 ring-border/50'
                  : 'border-border/60 bg-background/60 hover:border-border hover:bg-card/70'
              "
              @click="selectProfile(opt.value)"
            >
              <div>
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div
                      class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                      :class="
                        currentProfile === opt.value && hasOverride('contextProfile')
                          ? 'bg-primary text-white shadow-2xs'
                          : 'bg-header/70 text-text-secondary'
                      "
                    >
                      <i :class="opt.icon" class="text-xs" aria-hidden="true"></i>
                    </div>
                    <span class="text-xs font-semibold text-foreground">{{ opt.label }}</span>
                  </div>

                  <div
                    class="flex h-4 w-4 items-center justify-center rounded-full transition-all"
                    :class="
                      currentProfile === opt.value && hasOverride('contextProfile')
                        ? 'bg-primary text-white'
                        : currentProfile === opt.value
                          ? 'border border-border/90 bg-background text-text-secondary'
                          : 'border border-border/40 bg-transparent opacity-0 group-hover:opacity-40'
                    "
                  >
                    <i class="fa-solid fa-check text-[9px]" aria-hidden="true"></i>
                  </div>
                </div>

                <p class="mt-2 text-[11px] leading-relaxed text-text-secondary">
                  {{ opt.description }}
                </p>
              </div>

              <div class="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
                <span
                  v-if="currentProfile === opt.value && hasOverride('contextProfile')"
                  class="font-medium text-primary flex items-center gap-1"
                >
                  <i class="fa-solid fa-check text-[9px]"></i>
                  {{ $t('agent.settings.executionPolicy.customOverride') }}
                </span>
                <span v-else-if="currentProfile === opt.value" class="text-text-secondary/80 flex items-center gap-1">
                  <i class="fa-solid fa-link text-[8px]"></i>
                  {{ $t('agent.settings.executionPolicy.activeInherited') }}
                </span>
                <span v-else class="text-text-secondary/60 transition-colors group-hover:text-text-secondary">
                  {{ $t('agent.settings.executionPolicy.clickToOverride') }}
                </span>
              </div>
            </button>
          </div>
        </div>

        <!-- 上下文动态压缩策略 -->
        <div
          class="rounded-xl border border-border/70 bg-header/20 p-4 sm:p-5 shadow-2xs md:col-span-2 xl:col-span-3 transition-all"
        >
          <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <i class="fa-solid fa-compress text-xs" aria-hidden="true"></i>
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h4 class="text-xs font-semibold text-foreground">
                    {{ $t('agent.settings.executionPolicy.fields.contextCompactionMode') }}
                  </h4>
                  <span
                    v-if="hasOverride('contextCompactionMode')"
                    class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                  >
                    <i class="fa-solid fa-pen-to-square text-[9px]" aria-hidden="true"></i>
                    {{ $t('agent.settings.executionPolicy.customOverride') }}
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/60 px-2 py-0.5 text-[11px] text-text-secondary"
                  >
                    <i class="fa-solid fa-link text-[9px] text-text-secondary/70" aria-hidden="true"></i>
                    {{
                      $t('agent.settings.executionPolicy.compactionInherited', {
                        value: view.effective.contextCompactionMode,
                      })
                    }}
                  </span>
                </div>
                <p class="mt-0.5 text-[11px] text-text-secondary leading-relaxed">
                  {{ $t('agent.settings.executionPolicy.compactionHint') }}
                </p>
              </div>
            </div>

            <label
              class="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-text-secondary hover:border-border hover:bg-card cursor-pointer transition-all select-none"
            >
              <UiCheckbox
                :model-value="hasOverride('contextCompactionMode')"
                :disabled="busy || saving"
                @update:model-value="(value: boolean) => toggleOverride('contextCompactionMode', value)"
              />
              <span
                :class="hasOverride('contextCompactionMode') ? 'font-medium text-foreground' : 'text-text-secondary'"
              >
                {{ $t('agent.settings.executionPolicy.override') }}
              </span>
            </label>
          </div>

          <!-- 选项卡片 (3列) -->
          <div class="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button
              v-for="opt in compactionOptions"
              :key="opt.value"
              type="button"
              :disabled="busy || saving"
              class="group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer focus:outline-none"
              :class="
                currentCompaction === opt.value
                  ? hasOverride('contextCompactionMode')
                    ? 'border-primary bg-primary/10 shadow-2xs ring-1 ring-primary/25'
                    : 'border-border/90 bg-header/40 ring-1 ring-border/50'
                  : 'border-border/60 bg-background/60 hover:border-border hover:bg-card/70'
              "
              @click="selectCompaction(opt.value)"
            >
              <div>
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div
                      class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                      :class="
                        currentCompaction === opt.value && hasOverride('contextCompactionMode')
                          ? 'bg-primary text-white shadow-2xs'
                          : 'bg-header/70 text-text-secondary'
                      "
                    >
                      <i :class="opt.icon" class="text-xs" aria-hidden="true"></i>
                    </div>
                    <span class="text-xs font-semibold text-foreground">{{ opt.label }}</span>
                  </div>

                  <div
                    class="flex h-4 w-4 items-center justify-center rounded-full transition-all"
                    :class="
                      currentCompaction === opt.value && hasOverride('contextCompactionMode')
                        ? 'bg-primary text-white'
                        : currentCompaction === opt.value
                          ? 'border border-border/90 bg-background text-text-secondary'
                          : 'border border-border/40 bg-transparent opacity-0 group-hover:opacity-40'
                    "
                  >
                    <i class="fa-solid fa-check text-[9px]" aria-hidden="true"></i>
                  </div>
                </div>

                <p class="mt-2 text-[11px] leading-relaxed text-text-secondary">
                  {{ opt.description }}
                </p>
              </div>

              <div class="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
                <span
                  v-if="currentCompaction === opt.value && hasOverride('contextCompactionMode')"
                  class="font-medium text-primary flex items-center gap-1"
                >
                  <i class="fa-solid fa-check text-[9px]"></i>
                  {{ $t('agent.settings.executionPolicy.customOverride') }}
                </span>
                <span
                  v-else-if="currentCompaction === opt.value"
                  class="text-text-secondary/80 flex items-center gap-1"
                >
                  <i class="fa-solid fa-link text-[8px]"></i>
                  {{ $t('agent.settings.executionPolicy.activeInherited') }}
                </span>
                <span v-else class="text-text-secondary/60 transition-colors group-hover:text-text-secondary">
                  {{ $t('agent.settings.executionPolicy.clickToOverride') }}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2">
        <UiInfoHint v-if="!dirty" :text="$t('agent.settings.disabledReason.noChanges')" />
        <UiButton
          :appearance="dirty ? 'solid' : 'soft'"
          :tone="dirty ? 'primary' : 'neutral'"
          type="button"
          :disabled="busy || saving || loading || invalid || !dirty"
          @click="save"
        >
          {{ $t('common.save') }}
        </UiButton>
      </div>
    </div>
  </section>
</template>
