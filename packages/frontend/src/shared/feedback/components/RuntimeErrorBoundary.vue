<script setup lang="ts">
  import { onErrorCaptured, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { logger } from '@/client/logging/logger';
  import { UiButton } from '@/foundation/ui';

  const props = defineProps<{
    scope: string;
    resetKey?: string | number | null;
  }>();

  const { t } = useI18n();
  const error = ref<Error | null>(null);
  const generation = ref(0);

  const reset = (): void => {
    error.value = null;
    generation.value += 1;
  };

  watch(
    () => props.resetKey,
    () => reset(),
  );

  onErrorCaptured((cause, instance, info) => {
    error.value = cause instanceof Error ? cause : new Error(String(cause));
    logger.error(
      {
        err: cause,
        runtimeBoundary: props.scope,
        component: instance?.$options.name ?? null,
        info,
      },
      'Frontend runtime boundary captured descendant error',
    );
    return false;
  });

  defineExpose({ reset });
</script>

<template>
  <div v-if="!error" :key="generation" class="contents">
    <slot />
  </div>
  <div
    v-else
    data-testid="runtime-error-boundary"
    :data-runtime-boundary="scope"
    class="flex min-h-0 flex-1 items-center justify-center p-4"
    role="alert"
  >
    <div class="flex max-w-md flex-col items-center gap-3 text-center">
      <i class="fas fa-triangle-exclamation text-xl text-error" aria-hidden="true"></i>
      <p class="text-sm font-medium text-foreground">{{ t('common.errorOccurred') }}</p>
      <UiButton appearance="soft" tone="neutral" density="compact" @click="reset">
        {{ t('common.retry') }}
      </UiButton>
    </div>
  </div>
</template>
