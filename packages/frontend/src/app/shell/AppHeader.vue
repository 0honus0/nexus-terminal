<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { RouterLink, useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { useAuthSession } from '@/features/auth/public';
  import { usePreferences } from '@/features/preferences/public';

  const emit = defineEmits<{ customizeAppearance: [] }>();
  const router = useRouter();
  const route = useRoute();
  const { t } = useI18n();
  const auth = useAuthSession();
  const preferences = usePreferences();
  const logoutError = ref<string | null>(null);
  const loggingOut = ref(false);
  onMounted(() => {
    if (auth.isAuthenticated.value) void preferences.load();
  });

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
    class="sticky top-0 z-30 flex h-14 items-center border-b border-border bg-header px-3 shadow-sm sm:px-6"
  >
    <nav class="flex w-full items-center justify-between gap-3" :aria-label="t('common.primaryNavigation')">
      <div class="flex min-w-0 items-center gap-1">
        <img src="@/assets/logo.png" :alt="t('projectName')" class="mr-1 h-10 w-auto shrink-0" />
        <RouterLink class="nav-link" to="/">{{ t('nav.dashboard') }}</RouterLink>
        <RouterLink class="nav-link" to="/workspace">{{ t('nav.terminal') }}</RouterLink>
        <RouterLink class="nav-link hidden md:inline-flex" to="/connections">{{ t('nav.connections') }}</RouterLink>
        <RouterLink class="nav-link hidden md:inline-flex" to="/proxies">{{ t('nav.proxies') }}</RouterLink>
        <RouterLink class="nav-link hidden lg:inline-flex" to="/notifications">{{ t('nav.notifications') }}</RouterLink>
        <RouterLink class="nav-link hidden lg:inline-flex" to="/audit-logs">{{ t('nav.auditLogs') }}</RouterLink>
        <RouterLink class="nav-link" to="/settings">{{ t('nav.settings') }}</RouterLink>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <button
          v-if="auth.isAuthenticated.value"
          type="button"
          class="nav-link"
          :title="t('nav.customizeStyle')"
          :aria-label="t('nav.customizeStyle')"
          @click="emit('customizeAppearance')"
        >
          ◐
        </button>
        <RouterLink v-if="!auth.isAuthenticated.value" class="nav-link" to="/login">{{ t('nav.login') }}</RouterLink>
        <a v-else class="nav-link" href="/login" :aria-busy="loggingOut || undefined" @click.prevent="logout">
          {{ t('nav.logout') }}
        </a>
      </div>
    </nav>
    <p v-if="logoutError" class="sr-only" role="alert">{{ logoutError }}</p>
  </header>
</template>

<style scoped>
  .nav-link {
    display: inline-flex;
    white-space: nowrap;
    border-radius: 0.375rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-color-secondary);
    text-decoration: none;
    transition:
      color 150ms ease,
      background-color 150ms ease;
  }

  .nav-link:hover,
  .nav-link.router-link-exact-active {
    color: var(--link-active-color);
    background: var(--nav-item-active-bg-color);
  }
</style>
