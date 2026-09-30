<script setup lang="ts">
  import { defineAsyncComponent } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { UiButton } from '@/foundation/ui';
  import type { ConnectionDto } from '@/features/connections/public';
  import {
    loadSuspendedSessionsPanel,
    type MarkedSuspendedSessionState,
    type SuspendedSessionDto,
  } from '@/features/ssh-suspend/public';
  import WorkspaceConnectionList from './WorkspaceConnectionList.vue';

  defineProps<{ markedSessions: MarkedSuspendedSessionState[]; canReturn?: boolean; mobile?: boolean }>();
  const emit = defineEmits<{
    open: [connection: ConnectionDto];
    openMany: [connections: ConnectionDto[]];
    resume: [session: SuspendedSessionDto];
    resumeMarked: [workspaceId: string];
    unmark: [workspaceId: string];
    back: [];
  }>();
  const { t } = useI18n();
  const SuspendedSessionsPanel = defineAsyncComponent(loadSuspendedSessionsPanel);
</script>

<template>
  <section
    data-testid="workspace-start-page"
    class="workspace-start-page min-h-0 flex-1 overflow-y-auto bg-background"
    :class="mobile ? '' : 'mx-2 mb-2 rounded-b-md border border-t-0 border-border'"
  >
    <div class="workspace-start-layout min-h-full w-full">
      <div class="workspace-start-content flex min-w-0 flex-col">
        <header class="shrink-0">
          <div class="flex w-full items-center justify-between gap-3 px-4 py-4 sm:px-5">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <i class="fas fa-terminal text-sm" aria-hidden="true"></i>
              </span>
              <div class="min-w-0">
                <h1 class="text-sm font-semibold text-foreground">
                  {{ t('workspace.start.title') }}
                </h1>
                <p class="mt-0.5 text-xs leading-relaxed text-text-secondary">{{ t('workspace.start.description') }}</p>
              </div>
            </div>
            <UiButton v-if="canReturn" size="sm" @click="emit('back')">
              {{ t('workspace.start.back') }}
            </UiButton>
          </div>
        </header>
        <div class="grid w-full min-w-0 flex-1 items-stretch lg:grid-cols-2">
          <section class="order-2 min-w-0 p-4 sm:p-5">
            <h2 class="mb-2 flex h-7 items-center gap-2 text-sm font-semibold text-foreground">
              <i class="fas fa-pause-circle text-primary/80" aria-hidden="true"></i>
              {{ t('suspendedSshSessions.modalTitle') }}
            </h2>
            <SuspendedSessionsPanel
              :can-resume="true"
              :marked-sessions="markedSessions"
              :page-scroll="true"
              @resume="emit('resume', $event)"
              @resume-marked="emit('resumeMarked', $event)"
              @unmark="emit('unmark', $event)"
            />
          </section>
          <section class="order-1 min-w-0 p-4 sm:p-5">
            <h2 class="mb-2 flex h-7 items-center gap-2 text-sm font-semibold text-foreground">
              <i class="fas fa-plug text-primary/80" aria-hidden="true"></i>
              {{ t('workspace.start.connections') }}
            </h2>
            <WorkspaceConnectionList
              :page-scroll="true"
              @open="emit('open', $event)"
              @open-many="emit('openMany', $event)"
            />
          </section>
        </div>
      </div>
      <aside class="workspace-start-decoration" aria-hidden="true" inert>
        <div class="workspace-start-orbit workspace-start-orbit--outer"></div>
        <div class="workspace-start-orbit workspace-start-orbit--inner"></div>
        <div class="workspace-start-terminal">
          <div class="workspace-start-terminal-bar"><span></span><span></span><span></span></div>
          <div class="workspace-start-terminal-body">
            <i class="fas fa-terminal"></i>
            <div class="workspace-start-code"><span></span><span></span><span></span><span></span></div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
  .workspace-start-layout {
    display: flex;
  }
  .workspace-start-content {
    width: 100%;
    flex-shrink: 0;
  }
  .workspace-start-decoration {
    display: none;
  }
  @media (min-width: 1280px) {
    .workspace-start-content {
      width: 960px;
    }
    .workspace-start-decoration {
      display: flex;
      position: relative;
      min-width: 0;
      flex: 1;
      overflow: hidden;
      align-items: center;
      justify-content: center;
      background: radial-gradient(
        ellipse at center,
        color-mix(in srgb, var(--link-active-color) 7%, transparent),
        transparent 70%
      );
    }
    .workspace-start-orbit {
      position: absolute;
      width: 340px;
      height: 340px;
      border: 1px solid color-mix(in srgb, var(--link-active-color) 9%, transparent);
      border-radius: 50%;
    }
    .workspace-start-orbit--outer {
      width: 490px;
      height: 490px;
      border-style: dashed;
    }
    .workspace-start-terminal {
      position: relative;
      width: min(260px, 75%);
      border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
      border-radius: 16px;
      background: color-mix(in srgb, var(--card-bg-color) 45%, transparent);
      transform: rotate(-6deg);
      color: color-mix(in srgb, var(--link-active-color) 35%, transparent);
    }
    .workspace-start-terminal-bar {
      display: flex;
      gap: 6px;
      padding: 14px;
      border-bottom: 1px solid color-mix(in srgb, var(--border-color) 30%, transparent);
    }
    .workspace-start-terminal-bar span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--text-color-secondary) 25%, transparent);
    }
    .workspace-start-terminal-body {
      padding: 25px;
      font-size: 28px;
    }
    .workspace-start-code {
      display: grid;
      gap: 12px;
      margin-top: 22px;
    }
    .workspace-start-code span {
      height: 5px;
      border-radius: 4px;
      background: currentColor;
      opacity: 0.4;
    }
    .workspace-start-code span:nth-child(2) {
      width: 65%;
    }
    .workspace-start-code span:nth-child(3) {
      width: 80%;
    }
    .workspace-start-code span:nth-child(4) {
      width: 45%;
    }
  }
</style>
