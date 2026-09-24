<script setup lang="ts">
  import { computed, reactive, useId, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal, UiButton, UiCheckbox, UiSelect } from '@/foundation/ui';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import { formatAgentDateTime } from '../locale-format';
  import type { AgentProviderViewDto, AgentReasoningEffortDto } from '../api/agent-api';
  import { NONE_OPTION } from './pick-option';

  type AgentProviderModelDto = AgentProviderViewDto['models'][number];
  type CapabilityField =
    'contextWindow' | 'maxOutputTokens' | 'supportsTools' | 'supportsImageInput' | 'supportsFileInput';

  const props = defineProps<{
    visible: boolean;
    provider: AgentProviderViewDto | null;
    model: AgentProviderModelDto | null;
    busy: boolean;
  }>();

  const emit = defineEmits<{
    close: [];
    save: [model: AgentProviderModelDto];
  }>();

  const { t, locale } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.model-capabilities');
  const capabilityEditorId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const contextWindowInputId = `agent-model-context-window-${capabilityEditorId}`;
  const maxOutputTokensInputId = `agent-model-max-output-${capabilityEditorId}`;
  const capabilityEditorProvider = computed(() => props.provider);
  const capabilityEditorModel = computed(() => props.model);
  const reasoningEffortOptions: AgentReasoningEffortDto[] = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ];
  const defaultReasoningEffortOptions = computed(() => [
    { value: NONE_OPTION, label: t('agent.settings.providers.reasoningNoDefault') },
    ...capabilityForm.reasoningEfforts.map((effort) => ({ value: effort, label: effort })),
  ]);
  const setDefaultReasoningEffort = (value: unknown): void => {
    if (value === NONE_OPTION) {
      capabilityForm.defaultReasoningEffort = '';
      return;
    }
    const matched = capabilityForm.reasoningEfforts.find((effort) => effort === value);
    if (matched) capabilityForm.defaultReasoningEffort = matched;
  };

  const capabilityForm = reactive({
    contextWindow: 0,
    maxOutputTokens: 0,
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
    reasoningEnabled: false,
    reasoningEfforts: [] as AgentReasoningEffortDto[],
    defaultReasoningEffort: '' as AgentReasoningEffortDto | '',
    reasoningMandatory: false,
  });

  const syncForm = (model: AgentProviderModelDto | null): void => {
    if (!model) return;
    capabilityForm.contextWindow = model.contextWindow;
    capabilityForm.maxOutputTokens = model.maxOutputTokens;
    capabilityForm.supportsTools = model.supportsTools;
    capabilityForm.supportsImageInput = model.supportsImageInput;
    capabilityForm.supportsFileInput = model.supportsFileInput;
    capabilityForm.reasoningEnabled = Boolean(model.reasoningEfforts?.length);
    capabilityForm.reasoningEfforts = [...(model.reasoningEfforts ?? [])];
    capabilityForm.defaultReasoningEffort = model.defaultReasoningEffort ?? '';
    capabilityForm.reasoningMandatory = model.reasoningMandatory ?? false;
  };

  watch(() => props.model, syncForm, { immediate: true });

  const capabilityBaseline = (field: CapabilityField): number | boolean | undefined => {
    const model = capabilityEditorModel.value;
    if (!model) return undefined;
    return model.providerCapabilities?.capabilities[field] ?? model.registryDefaults?.[field];
  };

  const capabilityBaselineSource = (field: CapabilityField): 'provider' | 'registry' | undefined => {
    const model = capabilityEditorModel.value;
    if (!model) return undefined;
    if (model.providerCapabilities?.capabilities[field] !== undefined) return 'provider';
    if (model.registryDefaults?.[field] !== undefined) return 'registry';
    return undefined;
  };

  const restoreCapabilityField = (field: CapabilityField): void => {
    const baseline = capabilityBaseline(field);
    if (baseline === undefined) return;
    if (field === 'supportsTools') capabilityForm.supportsTools = Boolean(baseline);
    else if (field === 'supportsImageInput') capabilityForm.supportsImageInput = Boolean(baseline);
    else if (field === 'supportsFileInput') capabilityForm.supportsFileInput = Boolean(baseline);
    else capabilityForm[field] = Number(baseline);
  };

  const restoreAllCapabilities = (): void => {
    restoreCapabilityField('contextWindow');
    restoreCapabilityField('maxOutputTokens');
    restoreCapabilityField('supportsTools');
    restoreCapabilityField('supportsImageInput');
    restoreCapabilityField('supportsFileInput');
  };

  const capabilityFieldHasBaseline = (field: CapabilityField): boolean => capabilityBaseline(field) !== undefined;

  const capabilityFieldIsDefault = (field: CapabilityField): boolean => {
    const baseline = capabilityBaseline(field);
    return baseline !== undefined && capabilityForm[field] === baseline;
  };

  const capabilitySourceLabel = (field: CapabilityField): string => {
    if (!capabilityFieldIsDefault(field)) return t('agent.settings.providers.manualOverride');
    return capabilityBaselineSource(field) === 'provider'
      ? t('agent.settings.providers.providerLive')
      : t('agent.settings.providers.registryDefault');
  };

  const formatCapabilityTimestamp = (value: number): string =>
    formatAgentDateTime(locale.value, new Date(value * 1000));

  const reasoningBaseline = computed(
    () =>
      capabilityEditorModel.value?.providerCapabilities?.capabilities.reasoning ??
      capabilityEditorModel.value?.registryDefaults?.reasoning,
  );

  const toggleReasoningEffort = (effort: AgentReasoningEffortDto): void => {
    const next = new Set(capabilityForm.reasoningEfforts);
    if (next.has(effort)) next.delete(effort);
    else next.add(effort);
    capabilityForm.reasoningEfforts = reasoningEffortOptions.filter((candidate) => next.has(candidate));
    if (
      capabilityForm.defaultReasoningEffort &&
      !capabilityForm.reasoningEfforts.includes(capabilityForm.defaultReasoningEffort)
    ) {
      capabilityForm.defaultReasoningEffort = '';
    }
  };

  const close = (): void => {
    if (props.busy) return;
    emit('close');
  };

  const saveCapabilities = (): void => {
    const model = capabilityEditorModel.value;
    if (!capabilityEditorProvider.value || !model) return;
    if (
      !Number.isSafeInteger(capabilityForm.contextWindow) ||
      capabilityForm.contextWindow < 2 ||
      !Number.isSafeInteger(capabilityForm.maxOutputTokens) ||
      capabilityForm.maxOutputTokens < 1 ||
      capabilityForm.maxOutputTokens >= capabilityForm.contextWindow
    ) {
      operationFeedback.notifyError({
        operation: 'validate-capability-edit',
        message: t('agent.settings.providers.capabilityInvalid'),
        context: { providerId: capabilityEditorProvider.value.id, modelId: model.id },
      });
      return;
    }
    if (capabilityForm.reasoningEnabled && capabilityForm.reasoningEfforts.length === 0) {
      operationFeedback.notifyError({
        operation: 'validate-capability-edit',
        message: t('agent.settings.providers.reasoningSelectOne'),
        context: { providerId: capabilityEditorProvider.value.id, modelId: model.id },
      });
      return;
    }
    const {
      reasoningEfforts: _reasoningEfforts,
      defaultReasoningEffort: _defaultReasoningEffort,
      reasoningSource: _reasoningSource,
      reasoningMandatory: _reasoningMandatory,
      ...baseModel
    } = model;
    emit('save', {
      ...baseModel,
      contextWindow: capabilityForm.contextWindow,
      maxOutputTokens: capabilityForm.maxOutputTokens,
      supportsTools: capabilityForm.supportsTools,
      supportsImageInput: capabilityForm.supportsImageInput,
      supportsFileInput: capabilityForm.supportsFileInput,
      ...(capabilityForm.reasoningEnabled
        ? {
            reasoningEfforts: [...capabilityForm.reasoningEfforts],
            ...(capabilityForm.defaultReasoningEffort
              ? { defaultReasoningEffort: capabilityForm.defaultReasoningEffort }
              : {}),
            reasoningMandatory: capabilityForm.reasoningMandatory,
          }
        : {}),
    });
  };
</script>

<template>
  <BaseModal
    :visible="visible && Boolean(capabilityEditorModel)"
    :title="$t('agent.settings.providers.capabilityTitle')"
    :aria-label="$t('agent.settings.providers.capabilityTitle')"
    :close-on-backdrop="!busy"
    :close-on-escape="!busy"
    :focus-on-open="true"
    panel-class="max-w-lg p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
    @close="close"
  >
    <div v-if="capabilityEditorModel" class="space-y-4">
      <div>
        <div class="font-mono text-sm font-semibold text-foreground">{{ capabilityEditorModel.id }}</div>
        <div class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.providers.capabilityDescription') }}</div>
        <div
          v-if="capabilityEditorModel.providerCapabilities"
          class="mt-2 rounded-lg border border-border/70 bg-header/20 px-3 py-2 text-[11px] text-text-secondary"
        >
          {{
            $t('agent.settings.providers.providerMetadata', {
              source: capabilityEditorModel.providerCapabilities.source,
              version: capabilityEditorModel.providerCapabilities.sourceVersion,
              updatedAt: formatCapabilityTimestamp(capabilityEditorModel.providerCapabilities.updatedAt),
            })
          }}
        </div>
        <div
          v-if="capabilityEditorModel.capabilityConflicts?.length"
          class="mt-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning"
        >
          {{
            $t('agent.settings.providers.capabilityConflict', {
              fields: capabilityEditorModel.capabilityConflicts.join(', '),
            })
          }}
        </div>
      </div>

      <div class="space-y-3">
        <div class="block">
          <div class="mb-1 flex items-center justify-between gap-2">
            <label :for="contextWindowInputId" class="text-xs font-medium text-foreground">{{
              $t('agent.settings.providers.contextWindow')
            }}</label>
            <div class="flex items-center gap-2 text-[11px]">
              <span :class="capabilityFieldIsDefault('contextWindow') ? 'text-primary' : 'text-text-secondary'">
                {{ capabilitySourceLabel('contextWindow') }}
              </span>
              <button
                v-if="capabilityFieldHasBaseline('contextWindow')"
                type="button"
                class="text-primary hover:underline disabled:opacity-50"
                :disabled="capabilityFieldIsDefault('contextWindow')"
                @click="restoreCapabilityField('contextWindow')"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
          <input
            :id="contextWindowInputId"
            v-model.number="capabilityForm.contextWindow"
            type="number"
            min="2"
            data-no-highlight
            class="h-9 w-full rounded-lg border border-border/80 bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
          />
        </div>

        <div class="block">
          <div class="mb-1 flex items-center justify-between gap-2">
            <label :for="maxOutputTokensInputId" class="text-xs font-medium text-foreground">{{
              $t('agent.settings.providers.maxOutputTokens')
            }}</label>
            <div class="flex items-center gap-2 text-[11px]">
              <span :class="capabilityFieldIsDefault('maxOutputTokens') ? 'text-primary' : 'text-text-secondary'">
                {{ capabilitySourceLabel('maxOutputTokens') }}
              </span>
              <button
                v-if="capabilityFieldHasBaseline('maxOutputTokens')"
                type="button"
                class="text-primary hover:underline disabled:opacity-50"
                :disabled="capabilityFieldIsDefault('maxOutputTokens')"
                @click="restoreCapabilityField('maxOutputTokens')"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
          <input
            :id="maxOutputTokensInputId"
            v-model.number="capabilityForm.maxOutputTokens"
            type="number"
            min="1"
            data-no-highlight
            class="h-9 w-full rounded-lg border border-border/80 bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
          />
        </div>

        <div
          v-for="field in ['supportsTools', 'supportsImageInput', 'supportsFileInput'] as const"
          :key="field"
          class="rounded-lg border border-border/70 bg-header/20 px-3 py-2.5"
        >
          <div class="flex items-center justify-between gap-3">
            <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <UiCheckbox v-model="capabilityForm[field]" />
              <span>{{
                $t(
                  `agent.settings.providers.${field === 'supportsTools' ? 'tools' : field === 'supportsImageInput' ? 'imageInput' : 'fileInput'}`,
                )
              }}</span>
            </label>
            <div class="flex items-center gap-2 text-[11px]">
              <span :class="capabilityFieldIsDefault(field) ? 'text-primary' : 'text-text-secondary'">
                {{ capabilitySourceLabel(field) }}
              </span>
              <button
                v-if="capabilityFieldHasBaseline(field)"
                type="button"
                class="text-primary hover:underline disabled:opacity-50"
                :disabled="capabilityFieldIsDefault(field)"
                @click="restoreCapabilityField(field)"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
        </div>

        <div class="rounded-lg border border-border/70 bg-header/20 px-3 py-2.5 text-xs">
          <div class="flex items-center justify-between gap-3">
            <label class="flex items-center gap-2 font-medium text-foreground">
              <UiCheckbox v-model="capabilityForm.reasoningEnabled" :disabled="Boolean(reasoningBaseline)" />
              <span>{{ $t('agent.settings.providers.reasoningCapability') }}</span>
            </label>
            <span v-if="reasoningBaseline" class="text-[11px] text-primary">
              {{
                capabilityEditorModel.reasoningSource === 'provider'
                  ? $t('agent.settings.providers.providerLive')
                  : $t('agent.settings.providers.registryManaged')
              }}
            </span>
            <span v-else class="text-[11px] text-text-secondary">
              {{ $t('agent.settings.providers.reasoningOptional') }}
            </span>
          </div>

          <div v-if="capabilityForm.reasoningEnabled" class="mt-2.5 space-y-2.5">
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="effort in reasoningEffortOptions"
                :key="effort"
                type="button"
                class="rounded-md border px-2 py-1 font-mono text-[11px] transition-colors"
                :class="
                  capabilityForm.reasoningEfforts.includes(effort)
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/70 bg-background text-text-secondary hover:text-foreground'
                "
                @click="toggleReasoningEffort(effort)"
              >
                {{ effort }}
              </button>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label class="block">
                <span class="mb-1 block text-[11px] text-text-secondary">{{
                  $t('agent.settings.providers.reasoningDefault')
                }}</span>
                <UiSelect
                  class="w-full"
                  :aria-label="$t('agent.settings.providers.reasoningDefault')"
                  :model-value="capabilityForm.defaultReasoningEffort || NONE_OPTION"
                  :options="defaultReasoningEffortOptions"
                  @update:model-value="(value: unknown) => setDefaultReasoningEffort(value)"
                />
              </label>
              <label class="flex items-end gap-2 pb-1 text-[11px] text-foreground">
                <UiCheckbox v-model="capabilityForm.reasoningMandatory" />
                <span>{{ $t('agent.settings.providers.reasoningMandatory') }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <UiButton
          appearance="soft"
          tone="neutral"
          v-if="capabilityEditorModel?.providerCapabilities || capabilityEditorModel?.registryDefaults"
          type="button"
          :disabled="busy"
          @click="restoreAllCapabilities"
        >
          {{ $t('agent.settings.providers.restoreAllDefaults') }}
        </UiButton>
        <span v-else></span>
        <div class="flex items-center gap-2">
          <UiButton appearance="soft" tone="neutral" type="button" :disabled="busy" @click="close">
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton appearance="solid" tone="primary" type="button" :disabled="busy" @click="saveCapabilities">
            {{ $t('common.save') }}
          </UiButton>
        </div>
      </div>
    </template>
  </BaseModal>
</template>
