<script setup lang="ts">
  import { computed, defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRoute } from 'vue-router';
  import { loadAppearanceSettingsPanel, useAppearance } from '@/features/appearance/public';
  import { AgentSettingsPanel } from '@/features/agent/public';
  import { BackupSettingsPanel } from '@/features/backup/public';
  import {
    loadPreferencesSettingsPanel,
    loadWorkspacePreferencesPanel,
    type PreferencesDto,
  } from '@/features/preferences/public';
  import { SecuritySettingsPanel } from '@/features/security/public';
  import { useAuthSession } from '@/features/auth/public';
  import { setLocale, supportedLocales } from '@/app/i18n';
  import AboutPanel from './AboutPanel.vue';
  import packageJson from '../../../../package.json';

  const PreferencesSettingsPanel = defineAsyncComponent(loadPreferencesSettingsPanel);
  const WorkspacePreferencesPanel = defineAsyncComponent(loadWorkspacePreferencesPanel);
  const AppearanceSettingsPanel = defineAsyncComponent(loadAppearanceSettingsPanel);
  type SettingsTab = 'workspace' | 'system' | 'security' | 'ipControl' | 'data' | 'appearance' | 'agent' | 'about';

  const { t } = useI18n();
  const route = useRoute();
  const auth = useAuthSession();
  const appearance = useAppearance();
  const active = ref<SettingsTab>('workspace');
  const visited = reactive(new Set<SettingsTab>(['workspace']));
  const mobileView = ref<'menu' | 'detail'>('detail');
  const currentVersion = packageJson.version;
  const contentContainer = ref<HTMLElement | null>(null);

  watch(
    active,
    (value) => {
      visited.add(value);
      contentContainer.value?.scrollTo({ top: 0, behavior: 'instant' });
    },
    { immediate: true },
  );

  interface TabItem {
    value: SettingsTab;
    labelKey: string;
    icon: string;
    iconColor: string;
    iconBg: string;
    descriptionKey: string;
    badge?: string;
  }

  interface TabGroup {
    id: string;
    titleKey: string;
    items: TabItem[];
  }

  const tabGroups = computed<TabGroup[]>(() => [
    {
      id: 'general',
      titleKey: 'settings.groups.general',
      items: [
        {
          value: 'workspace',
          labelKey: 'settings.tabs.workspace',
          icon: 'fa-solid fa-laptop-code',
          iconColor: 'text-blue-500',
          iconBg: 'bg-blue-500/10',
          descriptionKey: 'settings.descriptions.workspace',
        },
        {
          value: 'system',
          labelKey: 'settings.tabs.system',
          icon: 'fa-solid fa-sliders',
          iconColor: 'text-indigo-500',
          iconBg: 'bg-indigo-500/10',
          descriptionKey: 'settings.descriptions.system',
        },
        {
          value: 'appearance',
          labelKey: 'settings.tabs.appearance',
          icon: 'fa-solid fa-palette',
          iconColor: 'text-purple-500',
          iconBg: 'bg-purple-500/10',
          descriptionKey: 'settings.descriptions.appearance',
        },
      ],
    },
    {
      id: 'intelligence',
      titleKey: 'settings.groups.intelligence',
      items: [
        {
          value: 'agent',
          labelKey: 'agent.settings.tab',
          icon: 'fa-solid fa-wand-magic-sparkles',
          iconColor: 'text-primary',
          iconBg: 'bg-primary/15',
          descriptionKey: 'settings.descriptions.agent',
          badge: 'AI',
        },
      ],
    },
    {
      id: 'securityAndData',
      titleKey: 'settings.groups.securityAndData',
      items: [
        {
          value: 'security',
          labelKey: 'settings.tabs.security',
          icon: 'fa-solid fa-shield-halved',
          iconColor: 'text-emerald-500',
          iconBg: 'bg-emerald-500/10',
          descriptionKey: 'settings.descriptions.security',
        },
        {
          value: 'ipControl',
          labelKey: 'settings.tabs.ipControl',
          icon: 'fa-solid fa-network-wired',
          iconColor: 'text-teal-500',
          iconBg: 'bg-teal-500/10',
          descriptionKey: 'settings.descriptions.ipControl',
        },
        {
          value: 'data',
          labelKey: 'settings.tabs.dataManagement',
          icon: 'fa-solid fa-database',
          iconColor: 'text-amber-500',
          iconBg: 'bg-amber-500/10',
          descriptionKey: 'settings.descriptions.data',
        },
      ],
    },
    {
      id: 'systemInfo',
      titleKey: 'settings.groups.systemInfo',
      items: [
        {
          value: 'about',
          labelKey: 'settings.tabs.about',
          icon: 'fa-solid fa-circle-info',
          iconColor: 'text-slate-500',
          iconBg: 'bg-slate-500/10',
          descriptionKey: 'settings.descriptions.about',
        },
      ],
    },
  ]);

  const allTabs = computed<TabItem[]>(() => tabGroups.value.flatMap((g) => g.items));

  const currentTab = computed<TabItem>(
    () => allTabs.value.find((item) => item.value === active.value) ?? allTabs.value[0],
  );

  const selectTab = (tab: SettingsTab) => {
    if (active.value === tab) {
      if (contentContainer.value) {
        contentContainer.value.scrollTo({ top: 0, behavior: 'smooth' });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      active.value = tab;
    }
    mobileView.value = 'detail';
  };

  const handlePreferencesSaved = (preferences: PreferencesDto) => {
    setLocale(preferences.language);
  };

  onMounted(() => {
    const tabQuery = route.query.tab as SettingsTab | undefined;
    if (tabQuery && allTabs.value.some((t) => t.value === tabQuery)) {
      active.value = tabQuery;
      mobileView.value = 'detail';
    }
  });
</script>

<template>
  <main
    class="min-h-[calc(100dvh-3.5rem)] lg:h-[calc(100dvh-3.5rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-hidden bg-background text-foreground flex flex-col"
    :class="{
      'h-[calc(100dvh-3.5rem)] max-h-[calc(100dvh-3.5rem)] overflow-hidden': mobileView === 'detail',
    }"
  >
    <div
      class="mx-auto max-w-[1600px] 2xl:max-w-[1720px] w-full h-full flex flex-col min-h-0 px-3 sm:px-5 lg:pl-6 lg:pr-8 xl:pl-8 xl:pr-10"
    >
      <!-- 移动端：目录总览视图 (Mobile Menu Catalog) -->
      <div v-if="mobileView === 'menu'" class="space-y-6 lg:hidden py-4 sm:py-6" data-testid="settings-mobile-catalog">
        <header class="px-1">
          <h1 class="text-xl font-bold tracking-tight text-foreground">{{ t('settings.title') }}</h1>
          <p class="mt-1 text-xs text-text-secondary">{{ t('settings.descriptions.agent') }}</p>
        </header>

        <div v-for="group in tabGroups" :key="group.id" class="space-y-2">
          <h2 class="px-2 text-xs font-semibold text-text-secondary tracking-wide">
            {{ t(group.titleKey) }}
          </h2>
          <div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs divide-y divide-border">
            <button
              v-for="item in group.items"
              :key="item.value"
              type="button"
              class="flex w-full items-center justify-between p-3.5 text-left transition-colors hover:bg-header/50 active:bg-header/70"
              @click="selectTab(item.value)"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  :class="[item.iconBg, item.iconColor]"
                >
                  <i :class="item.icon" class="text-sm" aria-hidden="true"></i>
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-foreground">{{ t(item.labelKey) }}</span>
                    <span
                      v-if="item.badge"
                      class="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary"
                    >
                      {{ item.badge }}
                    </span>
                  </div>
                  <p class="mt-0.5 text-xs text-text-secondary truncate">
                    {{ t(item.descriptionKey) }}
                  </p>
                </div>
              </div>
              <i class="fa-solid fa-chevron-right shrink-0 text-xs text-text-secondary/50 ml-2" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- 主工作区：移动端详情页 或 桌面端两栏独立滚动布局 -->
      <div
        :class="{
          'hidden lg:flex': mobileView === 'menu',
          'flex flex-col lg:flex-row': mobileView === 'detail',
        }"
        class="h-full w-full min-h-0 gap-2 sm:gap-3 lg:gap-8 overflow-hidden"
      >
        <!-- 移动端：顶部紧凑导航栏 (单行高度，居中选项，右侧不设冗余标签，放不下时右侧隐藏/可滑动) -->
        <div class="flex items-center gap-2 pt-2.5 pb-1 lg:hidden shrink-0 w-full overflow-hidden">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-header transition-colors shrink-0"
            @click="mobileView = 'menu'"
          >
            <i class="fa-solid fa-chevron-left text-primary text-[11px]" aria-hidden="true"></i>
            <span>{{ t('settings.mobile.allSettings') }}</span>
          </button>

          <!-- 居中设置项（无遮挡时居中，放不下时右侧隐藏/可滑动） -->
          <div
            class="flex-1 min-w-0 flex items-center overflow-x-auto no-scrollbar py-0.5"
            role="tablist"
            :aria-label="t('settings.sectionsAriaLabel')"
          >
            <div class="flex items-center gap-1.5 mx-auto shrink-0">
              <button
                v-for="item in allTabs"
                :key="item.value"
                type="button"
                role="tab"
                :aria-selected="active === item.value"
                :aria-controls="`settings-panel-${item.value}`"
                class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer"
                :class="
                  active === item.value
                    ? 'border border-primary bg-primary text-white shadow-xs font-semibold'
                    : 'border border-border bg-card text-foreground hover:bg-header'
                "
                @click="selectTab(item.value)"
              >
                <i :class="item.icon" class="text-[11px]" aria-hidden="true"></i>
                <span>{{ t(item.labelKey) }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 桌面端左侧悬浮控制岛 (Desktop Vertically Centered Floating Island) -->
        <aside class="hidden lg:flex flex-col justify-center shrink-0 w-64 xl:w-72 h-full py-6 select-none">
          <div
            class="rounded-2xl border border-border bg-card p-3.5 xl:p-4 shadow-md dark:shadow-xl flex flex-col justify-between min-h-[560px] xl:min-h-[620px] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-y-contain no-scrollbar"
          >
            <div class="space-y-3.5 xl:space-y-4">
              <!-- 侧边栏头部 (Floating Dock Header) -->
              <div class="flex items-center gap-2.5 px-2.5 pt-1 pb-3.5 border-b border-border">
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-2xs"
                >
                  <i class="fa-solid fa-sliders text-xs" aria-hidden="true"></i>
                </div>
                <h1 class="text-sm font-bold text-foreground leading-none tracking-tight">{{ t('settings.title') }}</h1>
              </div>

              <!-- 分组导航 (Soft, breathable groups without harsh divider borders) -->
              <nav class="space-y-3.5 xl:space-y-4" role="tablist" :aria-label="t('settings.sectionsAriaLabel')">
                <div v-for="group in tabGroups" :key="group.id" class="space-y-1">
                  <div class="px-2.5 text-xs font-bold text-text-secondary uppercase tracking-wider">
                    {{ t(group.titleKey) }}
                  </div>
                  <div class="space-y-1">
                    <button
                      v-for="item in group.items"
                      :key="item.value"
                      type="button"
                      role="tab"
                      :aria-selected="active === item.value"
                      :aria-controls="`settings-panel-${item.value}`"
                      class="group relative flex w-full items-center justify-between rounded-xl px-2.5 py-2 xl:py-2.5 text-left text-xs transition-all duration-150 ease-out cursor-pointer"
                      :class="
                        active === item.value
                          ? 'border border-primary bg-primary text-white shadow-sm font-semibold'
                          : 'border border-border/70 bg-background/50 hover:bg-header hover:border-border text-foreground hover:text-foreground shadow-2xs font-medium'
                      "
                      @click="selectTab(item.value)"
                    >
                      <div class="flex items-center gap-2.5 min-w-0">
                        <div
                          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors"
                          :class="active === item.value ? 'bg-white/20 text-white' : [item.iconBg, item.iconColor]"
                        >
                          <i :class="item.icon" class="text-xs" aria-hidden="true"></i>
                        </div>
                        <span class="truncate">{{ t(item.labelKey) }}</span>
                      </div>
                      <span
                        v-if="item.badge"
                        class="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase transition-colors"
                        :class="active === item.value ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'"
                      >
                        {{ item.badge }}
                      </span>
                    </button>
                  </div>
                </div>
              </nav>
            </div>

            <!-- 底部状态指示 (Subtle Status & Version) -->
            <div
              class="pt-3 px-2 border-t border-border flex items-center justify-between text-xs text-text-secondary select-none font-medium"
            >
              <span class="inline-flex items-center gap-1.5 font-medium">
                <span class="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
                <span class="text-xs tracking-wide text-text-secondary">Nexus Console</span>
              </span>
              <span class="text-xs font-mono text-text-secondary">v{{ currentVersion }}</span>
            </div>
          </div>
        </aside>

        <!-- 右侧主内容区 (Independent Scroll Canvas) -->
        <section
          ref="contentContainer"
          class="min-w-0 flex-1 h-full min-h-0 overflow-y-auto overscroll-y-contain pt-1.5 pb-4 lg:py-6 pr-1 lg:pr-3 space-y-4 touch-pan-y"
        >
          <!-- 桌面端页面头部信息 (Seamless Borderless Header Banner) -->
          <div class="hidden lg:flex items-center justify-between pb-3.5 border-b border-border">
            <div class="flex items-center gap-3">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-xs"
                :class="[currentTab.iconBg, currentTab.iconColor]"
              >
                <i :class="currentTab.icon" class="text-base" aria-hidden="true"></i>
              </div>
              <div>
                <h2 class="text-base font-bold text-foreground leading-tight">
                  {{ t(currentTab.labelKey) }}
                </h2>
                <p class="text-xs text-text-secondary mt-1 leading-tight">
                  {{ t(currentTab.descriptionKey) }}
                </p>
              </div>
            </div>
          </div>

          <!-- 子面板容器 -->
          <div>
            <WorkspacePreferencesPanel
              v-if="visited.has('workspace')"
              v-show="active === 'workspace'"
              id="settings-panel-workspace"
            />
            <PreferencesSettingsPanel
              v-if="visited.has('system')"
              v-show="active === 'system'"
              id="settings-panel-system"
              section="system"
              :locales="supportedLocales"
              @saved="handlePreferencesSaved"
            />
            <SecuritySettingsPanel
              v-if="visited.has('security')"
              v-show="active === 'security'"
              id="settings-panel-security"
              section="security"
              :two-factor-enabled="auth.user.value?.twoFactorEnabled"
              @auth-changed="auth.refreshSession"
            />
            <SecuritySettingsPanel
              v-if="visited.has('ipControl')"
              v-show="active === 'ipControl'"
              id="settings-panel-ipControl"
              section="ipControl"
              :two-factor-enabled="auth.user.value?.twoFactorEnabled"
              @auth-changed="auth.refreshSession"
            />
            <BackupSettingsPanel v-if="visited.has('data')" v-show="active === 'data'" id="settings-panel-data" />
            <AppearanceSettingsPanel
              v-if="visited.has('appearance')"
              v-show="active === 'appearance'"
              id="settings-panel-appearance"
              @customize="appearance.openCustomizer()"
            />
            <AgentSettingsPanel v-if="visited.has('agent')" v-show="active === 'agent'" />
            <AboutPanel v-if="visited.has('about')" v-show="active === 'about'" id="settings-panel-about" />
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
</style>
