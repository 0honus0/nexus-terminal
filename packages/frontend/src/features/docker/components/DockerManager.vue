<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseSpinner } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { useDocker, type DockerSessionController } from '../composables/useDocker';
  import type { DockerCommand, DockerContainer } from '../model/docker';

  type DockerConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

  const props = withDefaults(
    defineProps<{
      session: DockerSessionController;
      intervalSeconds?: number;
      defaultExpand?: boolean;
      connectionState?: DockerConnectionState;
      connectionMessage?: string;
    }>(),
    { intervalSeconds: 5, defaultExpand: false, connectionState: 'connected', connectionMessage: '' },
  );
  const emit = defineEmits<{ terminalCommand: [command: string] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const docker = useDocker(
    props.session,
    () => props.intervalSeconds,
    () => props.defaultExpand,
  );
  const connecting = computed(() => ['idle', 'connecting', 'reconnecting'].includes(props.connectionState));

  const run = async (container: DockerContainer, action: DockerCommand) => {
    if (
      action === 'remove' &&
      !(await feedback.confirm({
        message: t('dockerManager.action.removeConfirm', { name: container.names[0] ?? container.id }),
        destructive: true,
      }))
    )
      return;
    try {
      await docker.command(container.id, action);
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const ports = (container: DockerContainer) =>
    container.ports
      .map((port) => {
        const publicSide = port.publicPort
          ? `${port.ip ? `${port.ip}:` : ''}${port.publicPort}->`
          : port.ip
            ? `${port.ip}:`
            : '';
        return `${publicSide}${port.privatePort}/${port.type}`;
      })
      .join(', ');
  const terminalCommand = (container: DockerContainer, kind: 'enter' | 'logs') => {
    emit(
      'terminalCommand',
      kind === 'enter' ? `docker exec -it ${container.id} sh` : `docker logs --tail 1000 -f ${container.id}`,
    );
  };
  const stateBadgeClass = (state: string) => {
    if (state === 'running') return 'bg-success/15 text-success';
    if (state === 'exited' || state === 'dead') return 'bg-error/15 text-error';
    if (state === 'paused') return 'bg-warning/15 text-warning';
    if (state === 'restarting') return 'bg-primary/15 text-primary';
    return 'bg-header text-text-secondary';
  };
</script>

<template>
  <section data-testid="docker-manager" class="docker-manager h-full min-h-0 overflow-hidden">
    <div v-if="connecting" class="docker-state">
      <BaseSpinner />
      <strong>{{ t('dockerManager.waitingForSsh') }}</strong>
      <small v-if="connectionMessage">{{ connectionMessage }}</small>
    </div>
    <div v-else-if="connectionState === 'disconnected'" class="docker-state">
      <strong>{{ t('dockerManager.error.sshDisconnected') }}</strong>
      <small v-if="connectionMessage">{{ connectionMessage }}</small>
    </div>
    <div v-else-if="connectionState === 'error'" class="docker-state text-error">
      <strong>{{ t('dockerManager.error.sshError') }}</strong>
      <small v-if="connectionMessage">{{ connectionMessage }}</small>
    </div>
    <div v-else-if="docker.loading.value && !docker.containers.value.length" class="docker-state">
      <BaseSpinner />
      <strong>{{ t('dockerManager.loading') }}</strong>
    </div>
    <div v-else-if="docker.error.value" class="docker-state text-error">
      <strong>{{ t('dockerManager.error.fetchFailed') }}</strong>
      <small>{{ docker.error.value }}</small>
    </div>
    <div v-else-if="!docker.available.value" class="docker-state">
      <strong>{{ t('dockerManager.notAvailable') }}</strong>
      <small>{{ t('dockerManager.installHintRemote') }}</small>
    </div>
    <div v-else-if="!docker.containers.value.length" class="docker-state">
      <span>{{ t('dockerManager.noContainers') }}</span>
    </div>
    <div v-else class="docker-table-wrap h-full min-h-0 overflow-auto rounded-lg border border-border">
      <table class="docker-table w-full border-collapse text-sm">
        <thead class="docker-head bg-header/70 text-left text-text-secondary">
          <tr>
            <th class="w-10 px-2 py-2"></th>
            <th class="px-3 py-2">{{ t('dockerManager.header.name') }}</th>
            <th class="px-3 py-2">{{ t('dockerManager.header.image') }}</th>
            <th class="px-3 py-2">{{ t('dockerManager.header.status') }}</th>
            <th class="px-3 py-2">{{ t('dockerManager.header.ports') }}</th>
            <th class="px-3 py-2">{{ t('dockerManager.header.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="container in docker.containers.value" :key="container.id">
            <tr :data-testid="`docker-row-${container.id}`" class="docker-row border-t border-border first:border-t-0">
              <td class="docker-expand-cell px-2 py-2 text-center">
                <button
                  type="button"
                  class="docker-touch-target rounded px-2 py-1 text-text-secondary hover:bg-header hover:text-foreground"
                  :title="
                    docker.expandedContainerIds.value.has(container.id) ? t('common.collapse') : t('common.expand')
                  "
                  :aria-label="
                    docker.expandedContainerIds.value.has(container.id) ? t('common.collapse') : t('common.expand')
                  "
                  @click="docker.toggleExpand(container.id)"
                >
                  {{ docker.expandedContainerIds.value.has(container.id) ? '▾' : '▸' }}
                </button>
              </td>
              <td class="docker-cell px-3 py-2" :data-label="t('dockerManager.header.name')">
                <span class="break-all font-medium">{{ container.names.join(', ') || container.id.slice(0, 12) }}</span>
              </td>
              <td class="docker-cell px-3 py-2 break-all" :data-label="t('dockerManager.header.image')">
                {{ container.image }}
              </td>
              <td class="docker-cell px-3 py-2" :data-label="t('dockerManager.header.status')">
                <span
                  class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="stateBadgeClass(container.state)"
                >
                  {{ container.status }}
                </span>
              </td>
              <td class="docker-cell px-3 py-2 text-xs" :data-label="t('dockerManager.header.ports')">
                {{ ports(container) || '—' }}
              </td>
              <td class="docker-cell docker-actions-cell px-3 py-2" :data-label="t('dockerManager.header.actions')">
                <div class="docker-actions flex flex-wrap gap-1">
                  <BaseButton
                    class="docker-touch-target"
                    size="sm"
                    :disabled="container.state === 'running'"
                    @click="run(container, 'start')"
                    >{{ t('dockerManager.action.start') }}</BaseButton
                  >
                  <BaseButton
                    data-testid="docker-stop"
                    class="docker-touch-target"
                    size="sm"
                    :disabled="container.state !== 'running'"
                    @click="run(container, 'stop')"
                    >{{ t('dockerManager.action.stop') }}</BaseButton
                  >
                  <BaseButton
                    class="docker-touch-target"
                    size="sm"
                    :disabled="container.state !== 'running'"
                    @click="run(container, 'restart')"
                    >{{ t('dockerManager.action.restart') }}</BaseButton
                  >
                  <BaseButton
                    class="docker-touch-target"
                    size="sm"
                    variant="danger"
                    @click="run(container, 'remove')"
                    >{{ t('dockerManager.action.remove') }}</BaseButton
                  >
                  <BaseButton
                    class="docker-touch-target"
                    size="sm"
                    variant="ghost"
                    @click="terminalCommand(container, 'enter')"
                    >{{ t('dockerManager.action.enter') }}</BaseButton
                  >
                  <BaseButton
                    class="docker-touch-target"
                    size="sm"
                    variant="ghost"
                    @click="terminalCommand(container, 'logs')"
                    >{{ t('dockerManager.action.logs') }}</BaseButton
                  >
                </div>
              </td>
            </tr>
            <tr
              v-if="docker.expandedContainerIds.value.has(container.id)"
              class="docker-detail-row border-t border-border"
            >
              <td colspan="6" class="bg-header/30 p-3">
                <dl
                  v-if="container.stats"
                  class="docker-stats-grid grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs"
                >
                  <dt class="font-medium text-text-secondary">{{ t('dockerManager.stats.cpu') }}</dt>
                  <dd class="font-mono">{{ container.stats.cpuPercent }}</dd>
                  <dt class="font-medium text-text-secondary">{{ t('dockerManager.stats.memory') }}</dt>
                  <dd class="font-mono">{{ container.stats.memoryUsage }} ({{ container.stats.memoryPercent }})</dd>
                  <dt class="font-medium text-text-secondary">{{ t('dockerManager.stats.netIO') }}</dt>
                  <dd class="font-mono">{{ container.stats.networkIo }}</dd>
                  <dt class="font-medium text-text-secondary">{{ t('dockerManager.stats.blockIO') }}</dt>
                  <dd class="font-mono">{{ container.stats.blockIo }}</dd>
                  <dt class="font-medium text-text-secondary">{{ t('dockerManager.stats.pids') }}</dt>
                  <dd class="font-mono">{{ container.stats.pids }}</dd>
                </dl>
                <p v-else class="text-center text-xs italic text-text-secondary">
                  {{ t('dockerManager.stats.noData') }}
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
  .docker-manager {
    container-name: docker-manager-pane;
    container-type: inline-size;
  }

  .docker-state {
    height: 100%;
    min-height: 8rem;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.5rem;
    padding: 1rem;
    color: var(--text-color-secondary);
    text-align: center;
  }

  .docker-actions {
    justify-content: flex-start;
  }

  @container docker-manager-pane (max-width: 600px) {
    .docker-table-wrap {
      border: 0;
      border-radius: 0;
      padding: 0.75rem;
    }

    .docker-table,
    .docker-table tbody {
      display: block;
      width: 100%;
    }

    .docker-head {
      display: none;
    }

    .docker-row {
      display: block;
      margin-bottom: 0.75rem;
      overflow: hidden;
      border: 1px solid var(--border-color);
      border-radius: 0.65rem;
      background: var(--app-bg-color);
    }

    .docker-row > td {
      display: grid;
      grid-template-columns: minmax(6rem, 38%) minmax(0, 1fr);
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
      border-top: 1px dashed color-mix(in srgb, var(--border-color) 65%, transparent);
      text-align: right;
    }

    .docker-row > td::before {
      content: attr(data-label);
      min-width: 0;
      color: var(--text-color-secondary);
      font-weight: 600;
      text-align: left;
    }

    .docker-expand-cell {
      display: flex !important;
      justify-content: flex-end;
      border-top: 0 !important;
    }

    .docker-expand-cell::before {
      display: none;
    }

    .docker-actions-cell {
      display: block !important;
      text-align: initial !important;
    }

    .docker-actions-cell::before {
      display: block !important;
      margin-bottom: 0.4rem;
    }

    .docker-actions {
      justify-content: flex-end;
    }

    .docker-detail-row {
      display: block;
      margin: -0.75rem 0 0.75rem;
      overflow: hidden;
      border: 1px solid var(--border-color);
      border-top: 0;
      border-radius: 0 0 0.65rem 0.65rem;
    }

    .docker-detail-row > td {
      display: block;
      width: 100%;
    }
  }

  @container docker-manager-pane (max-width: 320px) {
    .docker-row > td {
      grid-template-columns: minmax(0, 1fr);
      text-align: left;
    }

    .docker-actions {
      justify-content: flex-start;
    }

    .docker-stats-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.2rem;
    }
  }

  @media (pointer: coarse) {
    .docker-touch-target {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
