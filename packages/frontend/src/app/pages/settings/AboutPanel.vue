<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import packageJson from '../../../../package.json';
  import {
    fetchLatestRelease,
    isNewerRelease,
    releaseRepository,
    releaseRepositoryUrl,
    releaseUrl,
  } from './aboutRelease';

  const { t } = useI18n();
  const currentVersion = packageJson.version;
  const latestVersion = ref<string | null>(null);
  const checking = ref(false);
  const error = ref('');
  const controller = new AbortController();
  const updateAvailable = computed(() =>
    latestVersion.value ? isNewerRelease(latestVersion.value, currentVersion) : false,
  );

  const check = async (): Promise<void> => {
    checking.value = true;
    error.value = '';
    try {
      latestVersion.value = await fetchLatestRelease(controller.signal);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      const status = typeof cause === 'object' && cause && 'status' in cause ? Number(cause.status) : 0;
      error.value =
        status === 404
          ? t('settings.about.error.noReleases')
          : status === 403
            ? t('settings.about.error.rateLimit')
            : t('settings.about.error.checkFailed');
    } finally {
      checking.value = false;
    }
  };

  onMounted(check);
  onBeforeUnmount(() => controller.abort());
</script>

<template>
  <section class="rounded-lg border border-border bg-background p-6">
    <h2 class="mb-4 text-lg font-semibold text-foreground">{{ t('settings.category.about') }}</h2>
    <div class="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
      <span class="font-medium text-foreground">{{ t('settings.about.version') }}: {{ currentVersion }}</span>
      <span v-if="checking" class="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
        {{ t('settings.about.checkingUpdate') }}
      </span>
      <span v-else-if="error" class="rounded-full bg-error/10 px-2 py-1 text-xs text-error" :title="error">
        {{ t('settings.about.error.checkFailedShort') }}
      </span>
      <a
        v-else-if="updateAvailable && latestVersion"
        :href="releaseUrl(latestVersion)"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-full bg-warning/15 px-2 py-1 text-xs text-warning hover:underline"
      >
        {{ t('settings.about.updateAvailable', { version: latestVersion }) }}
      </a>
      <span v-else-if="latestVersion" class="rounded-full bg-success/10 px-2 py-1 text-xs text-success">
        {{ t('settings.about.latestVersion') }}
      </span>
      <span class="text-border">|</span>
      <a :href="releaseRepositoryUrl" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
        {{ releaseRepository }}
      </a>
    </div>
  </section>
</template>
