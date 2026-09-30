<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { RouterLink, useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { logger } from '@/client/logging/logger';
  import { useAuthSession } from '@/features/auth/public';
  import { usePreferences } from '@/features/preferences/public';
  import { releaseRepository, releaseRepositoryUrl } from '@/app/config/release';
  import { disposeWorkspaceRuntime } from '@/app/workspaceLifecycle';
  import { UiSelect, type UiSelectValue } from '@/foundation/ui';

  const emit = defineEmits<{ customizeAppearance: [] }>();
  const router = useRouter();
  const route = useRoute();
  const { t } = useI18n();
  const auth = useAuthSession();
  const preferences = usePreferences();
  const logoutError = ref<string | null>(null);
  const loggingOut = ref(false);
  const navigation = [
    { path: '/', label: 'nav.dashboard' },
    { path: '/workspace', label: 'nav.terminal' },
    { path: '/connections', label: 'nav.connections' },
    { path: '/proxies', label: 'nav.proxies' },
    { path: '/notifications', label: 'nav.notifications' },
    { path: '/audit-logs', label: 'nav.auditLogs' },
    { path: '/settings', label: 'nav.settings' },
  ];
  const navigationOptions = computed(() => navigation.map((item) => ({ value: item.path, label: t(item.label) })));
  const navigate = (value: UiSelectValue): void => {
    if (typeof value === 'string' && value !== route.path) void router.push(value);
  };

  onMounted(() => {
    if (auth.isAuthenticated.value)
      void preferences.load().catch((cause) => logger.error({ err: cause }, 'Failed to load header preferences'));
  });

  const logout = async (): Promise<void> => {
    if (loggingOut.value) return;
    loggingOut.value = true;
    logoutError.value = null;
    try {
      await disposeWorkspaceRuntime();
      await auth.logout();
      await router.push({ name: 'Login' });
    } catch (cause) {
      logoutError.value = apiErrorMessage(cause, t('common.errorOccurred'));
    } finally {
      loggingOut.value = false;
    }
  };
</script>

<template>
  <header
    data-testid="app-header"
    v-if="route.name !== 'Workspace' || preferences.values.value.navBarVisible"
    class="app-header sticky top-0 z-30 shrink-0"
  >
    <nav class="ui-floating-nav app-navigation" :aria-label="t('common.primaryNavigation')">
      <RouterLink to="/" class="app-brand" :aria-label="t('nav.dashboard')">
        <img src="@/assets/logo.png" :alt="t('projectName')" class="h-7 w-auto shrink-0" />
      </RouterLink>
      <div class="app-nav-links">
        <RouterLink v-for="item in navigation" :key="item.path" class="nav-link inline-flex" :to="item.path">{{
          t(item.label)
        }}</RouterLink>
      </div>
      <UiSelect
        class="app-nav-picker"
        trigger-class="!min-h-11"
        :model-value="route.path"
        :options="navigationOptions"
        :aria-label="t('common.primaryNavigation')"
        :placeholder="t('common.primaryNavigation')"
        text-align="center"
        @update:model-value="navigate"
      />

      <div class="app-nav-tools flex shrink-0 items-center gap-1">
        <a
          class="icon-link hidden md:inline-flex"
          :href="releaseRepositoryUrl"
          target="_blank"
          rel="noopener noreferrer"
          :title="releaseRepository"
          :aria-label="releaseRepository"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
            />
          </svg>
        </a>
        <button
          v-if="auth.isAuthenticated.value"
          type="button"
          class="icon-link inline-flex"
          :title="t('nav.customizeStyle')"
          :aria-label="t('nav.customizeStyle')"
          @click="emit('customizeAppearance')"
        >
          <i class="fas fa-paint-brush" aria-hidden="true"></i>
        </button>
        <RouterLink v-if="!auth.isAuthenticated.value" class="nav-link inline-flex" to="/login">{{
          t('nav.login')
        }}</RouterLink>
        <a
          v-else
          class="icon-link inline-flex"
          href="/login"
          :title="t('nav.logout')"
          :aria-label="t('nav.logout')"
          :aria-busy="loggingOut || undefined"
          @click.prevent="logout"
        >
          <i class="fas fa-sign-out-alt" aria-hidden="true"></i>
        </a>
      </div>
    </nav>
    <p v-if="logoutError" class="sr-only" role="alert">{{ logoutError }}</p>
  </header>
</template>

<style scoped>
  .app-header {
    height: var(--app-header-height);
    padding: calc(6px + env(safe-area-inset-top, 0px)) 8px 6px;
  }
  .app-navigation {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    width: 100%;
    height: 48px;
    margin-inline: auto;
    padding-inline: 16px;
  }
  .app-brand {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    min-height: 44px;
  }
  .app-nav-links {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .app-nav-tools {
    justify-self: end;
  }
  .app-nav-picker {
    display: none;
  }

  .nav-link,
  .icon-link {
    align-items: center;
    justify-content: center;
    border-radius: 0.625rem;
    color: var(--text-color-secondary);
    text-decoration: none;
    transition:
      color 150ms ease,
      background-color 150ms ease;
  }

  .nav-link {
    min-height: 36px;
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .icon-link {
    border: 0;
    background: transparent;
    width: 36px;
    height: 36px;
    font-size: 0.9375rem;
    line-height: 1;
    color: var(--icon-color);
  }

  .nav-link:hover,
  .icon-link:hover {
    color: var(--link-hover-color);
    background: var(--nav-item-active-bg-color);
  }

  .nav-link.router-link-exact-active {
    color: var(--link-active-color);
    background: var(--nav-item-active-bg-color);
  }

  .nav-link:focus-visible,
  .icon-link:focus-visible,
  .app-brand:focus-visible {
    outline: 2px solid var(--link-active-color);
    outline-offset: 2px;
  }
  @media (max-width: 1199px) {
    .app-navigation {
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 12px;
      padding-inline: 12px;
    }
    .app-nav-links {
      display: none;
    }
    .app-nav-picker {
      display: block;
      width: 100%;
      max-width: 240px;
      justify-self: center;
    }
  }
  @media (max-width: 767px) {
    .app-header {
      padding-inline: 0;
    }
    .icon-link {
      width: 44px;
      height: 44px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .nav-link,
    .icon-link {
      transition: none;
    }
  }
</style>
