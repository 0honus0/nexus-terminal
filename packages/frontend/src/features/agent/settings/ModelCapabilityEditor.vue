<script setup lang="ts">
  import { computed, reactive, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import type { AgentProviderView } from '../api/agent-api';

  type ProviderModel = AgentProviderView['models'][number];
  type CapabilityField =
    'contextWindow' | 'maxOutputTokens' | 'supportsTools' | 'supportsImageInput' | 'supportsFileInput';

  const props = defineProps<{
    visible: boolean;
    provider: AgentProviderView | null;
    model: ProviderModel | null;
    busy: boolean;
  }>();

  const emit = defineEmits<{
    close: [];
    save: [model: ProviderModel];
  }>();

  const { t } = useI18n();
  const feedback = useFeedback();
  const capabilityEditorProvider = computed(() => props.provider);
  const capabilityEditorModel = computed(() => props.model);
  const capabilityForm = reactive({
    contextWindow: 1,
    maxOutputTokens: 1,
    supportsTools: false,
    supportsImageInput: false,
    supportsFileInput: false,
  });

  const syncForm = (model: ProviderModel | null): void => {
    if (!model) return;
    capabilityForm.contextWindow = model.contextWindow;
    capabilityForm.maxOutputTokens = model.maxOutputTokens;
    capabilityForm.supportsTools = model.supportsTools;
    capabilityForm.supportsImageInput = model.supportsImageInput;
    capabilityForm.supportsFileInput = model.supportsFileInput;
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

  const formatCapabilityTimestamp = (value: number): string => new Date(value * 1000).toLocaleString();

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
      feedback.notifyError(t('agent.settings.providers.capabilityInvalid'));
      return;
    }
    emit('save', {
      ...model,
      contextWindow: capabilityForm.contextWindow,
      maxOutputTokens: capabilityForm.maxOutputTokens,
      supportsTools: capabilityForm.supportsTools,
      supportsImageInput: capabilityForm.supportsImageInput,
      supportsFileInput: capabilityForm.supportsFileInput,
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
        <label class="block">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-foreground">{{ $t('agent.settings.providers.contextWindow') }}</span>
            <div class="flex items-center gap-2 text-[10px]">
              <span :class="capabilityFieldIsDefault('contextWindow') ? 'text-primary' : 'text-text-secondary'">
                {{ capabilitySourceLabel('contextWindow') }}
              </span>
              <button
                v-if="capabilityFieldHasBaseline('contextWindow')"
                type="button"
                class="text-primary hover:underline disabled:opacity-40"
                :disabled="capabilityFieldIsDefault('contextWindow')"
                @click="restoreCapabilityField('contextWindow')"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
          <input
            v-model.number="capabilityForm.contextWindow"
            type="number"
            min="2"
            data-no-highlight
            class="h-9 w-full rounded-lg border border-border/80 bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
          />
        </label>

        <label class="block">
          <div class="mb-1 flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-foreground">{{
              $t('agent.settings.providers.maxOutputTokens')
            }}</span>
            <div class="flex items-center gap-2 text-[10px]">
              <span :class="capabilityFieldIsDefault('maxOutputTokens') ? 'text-primary' : 'text-text-secondary'">
                {{ capabilitySourceLabel('maxOutputTokens') }}
              </span>
              <button
                v-if="capabilityFieldHasBaseline('maxOutputTokens')"
                type="button"
                class="text-primary hover:underline disabled:opacity-40"
                :disabled="capabilityFieldIsDefault('maxOutputTokens')"
                @click="restoreCapabilityField('maxOutputTokens')"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
          <input
            v-model.number="capabilityForm.maxOutputTokens"
            type="number"
            min="1"
            data-no-highlight
            class="h-9 w-full rounded-lg border border-border/80 bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-border-hover"
          />
        </label>

        <div
          v-for="field in ['supportsTools', 'supportsImageInput', 'supportsFileInput'] as const"
          :key="field"
          class="rounded-lg border border-border/70 bg-header/20 px-3 py-2.5"
        >
          <div class="flex items-center justify-between gap-3">
            <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <input v-model="capabilityForm[field]" type="checkbox" class="rounded accent-primary" />
              <span>{{
                $t(
                  `agent.settings.providers.${field === 'supportsTools' ? 'tools' : field === 'supportsImageInput' ? 'imageInput' : 'fileInput'}`,
                )
              }}</span>
            </label>
            <div class="flex items-center gap-2 text-[10px]">
              <span :class="capabilityFieldIsDefault(field) ? 'text-primary' : 'text-text-secondary'">
                {{ capabilitySourceLabel(field) }}
              </span>
              <button
                v-if="capabilityFieldHasBaseline(field)"
                type="button"
                class="text-primary hover:underline disabled:opacity-40"
                :disabled="capabilityFieldIsDefault(field)"
                @click="restoreCapabilityField(field)"
              >
                {{ $t('agent.settings.providers.restoreDefault') }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="capabilityEditorModel.reasoningEfforts?.length"
          class="rounded-lg border border-border/70 bg-header/20 px-3 py-2.5 text-xs"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium text-foreground">{{ $t('agent.settings.providers.reasoningCapability') }}</span>
            <span class="text-[10px] text-primary">
              {{
                capabilityEditorModel.reasoningSource === 'provider'
                  ? $t('agent.settings.providers.providerLive')
                  : capabilityEditorModel.reasoningSource === 'manual'
                    ? $t('agent.settings.providers.manualOverride')
                    : $t('agent.settings.providers.registryManaged')
              }}
            </span>
          </div>
          <div class="mt-1 font-mono text-[11px] text-text-secondary">
            {{ capabilityEditorModel.reasoningEfforts.join(' · ') }}
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <button
          v-if="capabilityEditorModel?.providerCapabilities || capabilityEditorModel?.registryDefaults"
          type="button"
          class="rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-header disabled:opacity-50"
          :disabled="busy"
          @click="restoreAllCapabilities"
        >
          {{ $t('agent.settings.providers.restoreAllDefaults') }}
        </button>
        <span v-else></span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-header"
            :disabled="busy"
            @click="close"
          >
            {{ $t('common.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            :disabled="busy"
            @click="saveCapabilities"
          >
            {{ $t('common.save') }}
          </button>
        </div>
      </div>
    </template>
  </BaseModal>
</template>
