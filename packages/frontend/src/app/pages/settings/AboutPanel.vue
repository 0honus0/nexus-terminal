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
  } from '../../config/release';

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
  <section class="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
    <h2 class="border-b border-border bg-header/50 px-6 py-4 text-lg font-semibold text-foreground">
      {{ t('settings.category.about') }}
    </h2>
    <div class="space-y-4 p-6">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
        <span class="font-medium">{{ t('settings.about.version') }}: {{ currentVersion }}</span>
        <span v-if="checking" class="ml-2 inline-block rounded-full bg-blue-500 px-2 py-0.5 text-xs text-white italic">
          {{ t('settings.about.checkingUpdate') }}
        </span>
        <span
          v-else-if="error"
          class="ml-2 inline-block rounded-full bg-error px-2 py-0.5 text-xs text-white"
          :title="error"
        >
          {{ t('settings.about.error.checkFailedShort') }}
        </span>
        <a
          v-else-if="updateAvailable && latestVersion"
          :href="releaseUrl(latestVersion)"
          target="_blank"
          rel="noopener noreferrer"
          class="ml-2 inline-flex items-center rounded-full bg-warning px-2 py-0.5 text-xs text-white hover:bg-warning/80"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="mr-1 h-3 w-3"
            aria-hidden="true"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>
          {{ t('settings.about.updateAvailable', { version: latestVersion }) }}
        </a>
        <span
          v-else-if="latestVersion"
          class="ml-2 inline-block rounded-full bg-success px-2 py-0.5 text-xs text-white"
        >
          {{ t('settings.about.latestVersion') }}
        </span>
        <span class="opacity-50">|</span>
        <a
          :href="releaseRepositoryUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center text-primary hover:underline"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            fill="currentColor"
            class="mr-1"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
            />
          </svg>
          {{ releaseRepository }}
        </a>
      </div>
    </div>
  </section>
</template>
