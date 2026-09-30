<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { UiButton, UiEmptyState, UiManagementCard, UiModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import ProxyForm from '../components/ProxyForm.vue';
  import { useProxies } from '../composables/useProxies';
  import type { ProxyDto, ProxyCreateRequestDto } from '../model/proxy';
  const { t } = useI18n();
  const data = useProxies();
  const feedback = useFeedback();
  const modal = ref(false);
  const editing = ref<ProxyDto | null>(null);
  const loading = ref(false);
  const loadError = ref('');
  const initialLoading = ref(true);
  onMounted(async () => {
    initialLoading.value = true;
    loadError.value = '';
    try {
      await data.load();
    } catch (cause) {
      loadError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      initialLoading.value = false;
    }
  });
  const openAdd = () => {
    editing.value = null;
    modal.value = true;
  };
  const save = async (input: Partial<ProxyCreateRequestDto>) => {
    loading.value = true;
    try {
      if (editing.value) await data.update(editing.value.id, input);
      else await data.create(input as ProxyCreateRequestDto);
      modal.value = false;
    } catch (cause) {
      feedback.notifyError(
        t(editing.value ? 'proxies.form.errorUpdate' : 'proxies.form.errorAdd', {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      loading.value = false;
    }
  };
  const remove = async (p: ProxyDto) => {
    if (!(await feedback.confirm({ message: t('proxies.prompts.confirmDelete', { name: p.name }), destructive: true })))
      return;
    try {
      await data.remove(p.id);
    } catch (cause) {
      feedback.notifyError(
        t('proxies.errors.deleteFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
</script>
<template>
  <div class="p-4 text-foreground">
    <div class="mx-auto max-w-6xl">
      <h2 class="mb-4 border-b border-border pb-2 text-xl font-semibold text-foreground">{{ t('proxies.title') }}</h2>
      <UiButton v-if="!modal" type="button" appearance="solid" class="mb-4" @click="openAdd">
        {{ t('proxies.addProxy') }}
      </UiButton>

      <div class="mt-4">
        <div
          v-if="initialLoading && data.proxies.value.length === 0"
          class="ui-solid-inset mb-4 rounded-lg p-4 text-center text-text-secondary italic"
        >
          {{ t('proxies.loading') }}
        </div>
        <div v-else-if="loadError" class="mb-4 rounded border-l-4 border-error bg-error/10 p-4 text-error">
          {{ t('proxies.error', { error: loadError }) }}
        </div>
        <UiEmptyState
          v-else-if="data.proxies.value.length === 0"
          class="mb-4"
          icon="fa-solid fa-network-wired"
          :description="t('proxies.noProxies')"
        />
        <div v-else class="mt-4 grid gap-4">
          <UiManagementCard v-for="proxy in data.proxies.value" :key="proxy.id">
            <div class="min-w-0 flex-grow space-y-1">
              <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <strong class="min-w-0 break-words text-base font-semibold text-foreground">{{ proxy.name }}</strong>
                <span
                  class="rounded-full border border-border/60 bg-card/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-secondary"
                  >{{ proxy.type }}</span
                >
              </div>
              <div class="break-all text-sm text-text-secondary sm:break-normal">
                <i class="fas fa-server mr-1 text-xs opacity-70" aria-hidden="true" /> {{ proxy.host }}:{{ proxy.port }}
              </div>
              <div v-if="proxy.username" class="break-all text-sm text-text-secondary sm:break-normal">
                <i class="fas fa-user mr-1 text-xs opacity-70" aria-hidden="true" /> {{ proxy.username }}
              </div>
            </div>
            <template #actions>
              <UiButton
                type="button"
                appearance="soft"
                @click="
                  editing = proxy;
                  modal = true;
                "
              >
                <i class="fas fa-pencil-alt mr-1 text-xs" aria-hidden="true" />{{ t('proxies.actions.edit') }}
              </UiButton>
              <UiButton type="button" appearance="ghost" tone="danger" @click="remove(proxy)">
                <i class="fas fa-trash-alt mr-1 text-xs" aria-hidden="true" />{{ t('proxies.actions.delete') }}
              </UiButton>
            </template>
          </UiManagementCard>
        </div>
      </div>

      <UiModal
        :visible="modal"
        :close-on-backdrop="false"
        panel-class="ui-form-surface w-[calc(100vw-2rem)] max-w-lg sm:min-w-[350px]"
        content-class="!py-0"
        @close="modal = false"
      >
        <ProxyForm :proxy="editing" :loading="loading" @submit="save" @cancel="modal = false" />
      </UiModal>
    </div>
  </div>
</template>
