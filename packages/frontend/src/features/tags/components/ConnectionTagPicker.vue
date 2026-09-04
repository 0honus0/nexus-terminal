<script setup lang="ts">
  import { computed, onMounted } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { TokenInput, type TokenOption } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { useConnectionTags } from '../composables/useConnectionTags';

  const model = defineModel<number[]>({ default: () => [] });
  const tags = useConnectionTags();
  const feedback = useFeedback();
  const { t } = useI18n();

  onMounted(() => tags.load());
  const options = computed<TokenOption[]>(() => tags.tags.value.map((tag) => ({ value: tag.id, label: tag.name })));
  const create = async (name: string) => {
    const existing = tags.tags.value.find((tag) => tag.name.toLowerCase() === name.trim().toLowerCase());
    const tag = existing ?? (await tags.create(name));
    if (!model.value.includes(tag.id)) model.value = [...model.value, tag.id];
  };
  const deleteGlobally = async (option: TokenOption) => {
    const tag = tags.tags.value.find((item) => item.id === Number(option.value));
    if (!tag) return;
    if (!(await feedback.confirm({ message: t('tags.prompts.confirmDelete', { name: tag.name }), destructive: true })))
      return;
    try {
      await tags.remove(tag.id);
      model.value = model.value.filter((id) => id !== tag.id);
      feedback.notifySuccess(t('tags.deleteSuccess', { name: tag.name }));
    } catch (cause) {
      feedback.notifyError(
        t('tags.deleteFailed', { name: tag.name, error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
</script>

<template>
  <TokenInput
    v-model="model"
    :options="options"
    :placeholder="t('tags.inputPlaceholder')"
    :remove-token-label="t('tags.removeSelection')"
    :delete-option-label="t('tags.deleteTagGlobally')"
    allow-custom
    allow-option-delete
    @create="create"
    @delete-option="deleteGlobally"
  />
</template>
