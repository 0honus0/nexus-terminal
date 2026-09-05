<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { RouterLink, useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { useAuthSession } from '@/features/auth/public';
  import { usePreferences } from '@/features/preferences/public';
  import { releaseRepository, releaseRepositoryUrl } from '@/app/config/release';

  const emit = defineEmits<{ customizeAppearance: [] }>();
  const router = useRouter();
  const route = useRoute();
  const { t } = useI18n();
  const auth = useAuthSession();
  const preferences = usePreferences();
  const logoutError = ref<string | null>(null);
  const loggingOut = ref(false);
  const nav = ref<HTMLElement | null>(null);
  const underline = ref<HTMLElement | null>(null);

  const updateUnderline = async (): Promise<void> => {
    await nextTick();
    if (!nav.value || !underline.value) return;
    const active = nav.value.querySelector<HTMLElement>('.router-link-exact-active');
    if (!active || active.offsetWidth === 0) {
      underline.value.style.opacity = '0';
      return;
    }
    underline.value.style.left = `${active.offsetLeft}px`;
    underline.value.style.width = `${active.offsetWidth}px`;
    underline.value.style.opacity = '1';
  };

  const handleResize = (): void => void updateUnderline();

  onMounted(() => {
    if (auth.isAuthenticated.value) void preferences.load();
    window.addEventListener('resize', handleResize);
    void updateUnderline();
  });
  onBeforeUnmount(() => window.removeEventListener('resize', handleResize));
  watch(() => route.fullPath, updateUnderline);

  const logout = async (): Promise<void> => {
    if (loggingOut.value) return;
    loggingOut.value = true;
    logoutError.value = null;
    try {
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
    v-if="route.name !== 'Workspace' || preferences.values.value.navBarVisible"
    class="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-header pl-3 pr-6 shadow-sm"
  >
    <nav
      ref="nav"
      class="relative flex min-w-0 w-full items-center justify-between"
      :aria-label="t('common.primaryNavigation')"
    >
      <div class="flex min-w-0 items-center gap-1">
        <img src="@/assets/logo.png" :alt="t('projectName')" class="h-10 w-auto shrink-0" />
        <RouterLink class="nav-link inline-flex" to="/">{{ t('nav.dashboard') }}</RouterLink>
        <RouterLink class="nav-link inline-flex" to="/workspace">{{ t('nav.terminal') }}</RouterLink>
        <RouterLink class="nav-link hidden md:inline-flex" to="/connections">{{ t('nav.connections') }}</RouterLink>
        <RouterLink class="nav-link hidden md:inline-flex" to="/proxies">{{ t('nav.proxies') }}</RouterLink>
        <RouterLink class="nav-link hidden md:inline-flex" to="/notifications">{{ t('nav.notifications') }}</RouterLink>
        <RouterLink class="nav-link hidden md:inline-flex" to="/audit-logs">{{ t('nav.auditLogs') }}</RouterLink>
        <RouterLink class="nav-link inline-flex" to="/settings">{{ t('nav.settings') }}</RouterLink>
      </div>

      <div class="flex shrink-0 items-center gap-1">
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
          class="nav-link inline-flex"
          href="/login"
          :aria-busy="loggingOut || undefined"
          @click.prevent="logout"
        >
          {{ t('nav.logout') }}
        </a>
      </div>
      <div ref="underline" class="nav-underline" aria-hidden="true"></div>
    </nav>
    <p v-if="logoutError" class="sr-only" role="alert">{{ logoutError }}</p>
  </header>
</template>

<style scoped>
  .nav-link,
  .icon-link {
    align-items: center;
    justify-content: center;
    border-radius: 0.375rem;
    color: var(--text-color-secondary);
    text-decoration: none;
    transition:
      color 150ms ease,
      background-color 150ms ease;
  }

  .nav-link {
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .icon-link {
    border: 0;
    background: transparent;
    padding: 0.5rem;
    font-size: 1.125rem;
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

  .nav-underline {
    position: absolute;
    bottom: 0;
    height: 2px;
    border-radius: 9999px;
    background: var(--link-active-color);
    opacity: 0;
    pointer-events: none;
    transform: translateY(6px);
    transition:
      left 300ms ease,
      width 300ms ease,
      opacity 150ms ease;
  }
</style>
