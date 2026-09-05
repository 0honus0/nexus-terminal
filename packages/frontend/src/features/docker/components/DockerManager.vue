<script setup lang="ts">
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
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
    if (state === 'running') return 'bg-green-500 text-white';
    if (state === 'exited' || state === 'dead') return 'bg-red-500 text-white';
    if (state === 'paused') return 'bg-yellow-500 text-gray-800';
    if (state === 'restarting') return 'bg-blue-500 text-white';
    return 'bg-gray-500 text-white';
  };
</script>

<template>
  <section
    data-testid="docker-manager"
    class="docker-manager flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
  >
    <div v-if="connecting" class="docker-state">
      <i class="fas fa-spinner fa-spin text-4xl" aria-hidden="true"></i>
      <strong>{{ t('dockerManager.waitingForSsh') }}</strong>
      <small v-if="connectionMessage">{{ connectionMessage }}</small>
    </div>
    <div v-else-if="connectionState === 'disconnected'" class="docker-state">
      <i class="fas fa-unlink text-4xl" aria-hidden="true"></i>
      <strong>{{ t('dockerManager.error.sshDisconnected') }}</strong>
      <small v-if="connectionMessage">{{ connectionMessage }}</small>
    </div>
    <div v-else-if="connectionState === 'error'" class="docker-state text-error">
      <i class="fas fa-exclamation-circle text-3xl" aria-hidden="true"></i>
      <strong>{{ t('dockerManager.error.sshError') }}</strong>
      <small v-if="connectionMessage">{{ connectionMessage }}</small>
    </div>
    <div v-else-if="docker.loading.value && !docker.containers.value.length" class="docker-state">
      <i class="fas fa-spinner fa-spin text-4xl" aria-hidden="true"></i>
      <strong>{{ t('dockerManager.loading') }}</strong>
    </div>
    <div v-else-if="docker.error.value" class="docker-state text-error">
      <i class="fas fa-exclamation-triangle text-3xl" aria-hidden="true"></i>
      <strong>{{ t('dockerManager.error.fetchFailed') }}</strong>
      <small>{{ docker.error.value }}</small>
    </div>
    <div v-else-if="!docker.available.value" class="docker-state">
      <i class="fab fa-docker text-4xl" aria-hidden="true"></i>
      <strong>{{ t('dockerManager.notAvailable') }}</strong>
      <small>{{ t('dockerManager.installHintRemote') }}</small>
    </div>
    <div v-else-if="!docker.containers.value.length" class="docker-state">
      <span>{{ t('dockerManager.noContainers') }}</span>
    </div>

    <div v-else class="docker-content-area min-h-0 flex-1 overflow-auto">
      <table class="docker-table w-full border-collapse text-sm">
        <thead class="docker-head">
          <tr class="bg-header">
            <th class="w-8 border-b border-border px-2 py-2"></th>
            <th
              class="border-b border-border px-3 py-2 text-left font-medium uppercase tracking-wider text-text-secondary"
            >
              {{ t('dockerManager.header.name') }}
            </th>
            <th
              class="border-b border-border px-3 py-2 text-left font-medium uppercase tracking-wider text-text-secondary"
            >
              {{ t('dockerManager.header.image') }}
            </th>
            <th
              class="border-b border-border px-3 py-2 text-left font-medium uppercase tracking-wider text-text-secondary"
            >
              {{ t('dockerManager.header.status') }}
            </th>
            <th
              class="border-b border-border px-3 py-2 text-left font-medium uppercase tracking-wider text-text-secondary"
            >
              {{ t('dockerManager.header.ports') }}
            </th>
            <th
              class="border-b border-border px-3 py-2 text-left font-medium uppercase tracking-wider text-text-secondary"
            >
              {{ t('dockerManager.header.actions') }}
            </th>
          </tr>
        </thead>
        <tbody class="docker-body">
          <template v-for="container in docker.containers.value" :key="container.id">
            <tr
              :data-testid="`docker-row-${container.id}`"
              class="docker-row relative border border-border bg-background shadow-sm transition-colors duration-150 hover:bg-header/30"
              :class="{ expanded: docker.expandedContainerIds.value.has(container.id) }"
            >
              <td class="docker-expand-cell w-8 border-b border-border px-2 py-2 text-center align-middle">
                <button
                  type="button"
                  data-testid="docker-expand"
                  class="p-1 text-xs text-text-secondary transition-colors duration-150 hover:text-foreground"
                  :title="
                    docker.expandedContainerIds.value.has(container.id) ? t('common.collapse') : t('common.expand')
                  "
                  :aria-label="
                    docker.expandedContainerIds.value.has(container.id) ? t('common.collapse') : t('common.expand')
                  "
                  @click="docker.toggleExpand(container.id)"
                >
                  <i
                    :class="[
                      'fas',
                      docker.expandedContainerIds.value.has(container.id) ? 'fa-chevron-down' : 'fa-chevron-right',
                    ]"
                    aria-hidden="true"
                  ></i>
                </button>
              </td>

              <td
                class="docker-cell border-b border-border px-3 py-2 align-middle"
                :data-label="t('dockerManager.header.name')"
              >
                <span class="break-all font-medium">{{ container.names.join(', ') || container.id.slice(0, 12) }}</span>
              </td>
              <td
                class="docker-cell break-all border-b border-border px-3 py-2 align-middle"
                :data-label="t('dockerManager.header.image')"
              >
                {{ container.image }}
              </td>
              <td
                class="docker-cell border-b border-border px-3 py-2 align-middle"
                :data-label="t('dockerManager.header.status')"
              >
                <span
                  class="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="stateBadgeClass(container.state)"
                >
                  {{ container.status }}
                </span>
              </td>
              <td
                class="docker-cell break-all border-b border-border px-3 py-2 text-xs align-middle"
                :data-label="t('dockerManager.header.ports')"
              >
                {{ ports(container) || 'N/A' }}
              </td>
              <td
                class="docker-cell docker-actions-cell border-b border-border px-3 py-2 align-middle"
                :data-label="t('dockerManager.header.actions')"
              >
                <div class="docker-actions flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="docker-action docker-touch-target hover:text-green-500"
                    :disabled="container.state === 'running'"
                    :title="t('dockerManager.action.start')"
                    :aria-label="t('dockerManager.action.start')"
                    @click="run(container, 'start')"
                  >
                    <i class="fas fa-play" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    data-testid="docker-stop"
                    class="docker-action docker-touch-target hover:text-yellow-500"
                    :disabled="container.state !== 'running'"
                    :title="t('dockerManager.action.stop')"
                    :aria-label="t('dockerManager.action.stop')"
                    @click="run(container, 'stop')"
                  >
                    <i class="fas fa-stop" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="docker-action docker-touch-target hover:text-blue-500"
                    :disabled="container.state !== 'running'"
                    :title="t('dockerManager.action.restart')"
                    :aria-label="t('dockerManager.action.restart')"
                    @click="run(container, 'restart')"
                  >
                    <i class="fas fa-sync-alt" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="docker-action docker-touch-target hover:text-red-500"
                    :title="t('dockerManager.action.remove')"
                    :aria-label="t('dockerManager.action.remove')"
                    @click="run(container, 'remove')"
                  >
                    <i class="fas fa-trash-alt" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="docker-action docker-touch-target hover:text-blue-400"
                    :title="t('dockerManager.action.enter')"
                    :aria-label="t('dockerManager.action.enter')"
                    @click="terminalCommand(container, 'enter')"
                  >
                    <i class="fas fa-terminal" aria-hidden="true"></i>
                  </button>
                  <button
                    type="button"
                    class="docker-action docker-touch-target hover:text-gray-400"
                    :title="t('dockerManager.action.logs')"
                    :aria-label="t('dockerManager.action.logs')"
                    @click="terminalCommand(container, 'logs')"
                  >
                    <i class="fas fa-file-alt" aria-hidden="true"></i>
                  </button>
                </div>
              </td>

              <td class="docker-card-expand-cell">
                <div v-if="!docker.expandedContainerIds.value.has(container.id)">
                  <button
                    type="button"
                    class="docker-card-toggle docker-touch-target"
                    :aria-label="t('common.expand')"
                    @click="docker.toggleExpand(container.id)"
                  >
                    <i class="fas fa-chevron-down" aria-hidden="true"></i>
                    <span>{{ t('common.expand') }}</span>
                  </button>
                </div>
                <div v-else class="docker-card-details bg-header/30">
                  <div class="p-4">
                    <dl
                      v-if="container.stats"
                      class="docker-stats-grid grid grid-cols-[max-content_auto] gap-x-4 gap-y-2 text-xs"
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
                    <p v-else class="py-2 text-center text-xs italic text-text-secondary">
                      {{ t('dockerManager.stats.noData') }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="docker-card-toggle docker-touch-target border-t border-border"
                    :aria-label="t('common.collapse')"
                    @click="docker.toggleExpand(container.id)"
                  >
                    <i class="fas fa-chevron-up" aria-hidden="true"></i>
                    <span>{{ t('common.collapse') }}</span>
                  </button>
                </div>
              </td>
            </tr>

            <tr v-if="docker.expandedContainerIds.value.has(container.id)" class="docker-detail-row">
              <td colspan="6" class="border-b border-border bg-header/30 p-4">
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
                <p v-else class="py-2 text-center text-xs italic text-text-secondary">
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
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.55rem;
    padding: 1rem;
    color: var(--text-color-secondary);
    text-align: center;
  }

  .docker-state small {
    max-width: 80%;
    color: var(--text-color-disabled, var(--text-color-secondary));
  }

  .docker-actions {
    justify-content: flex-start;
  }

  .docker-action {
    padding: 0.125rem;
    border: 0;
    border-radius: 0.25rem;
    color: var(--text-color-secondary);
    background: transparent;
    font-size: 1rem;
    line-height: 1;
    transition: color 0.15s ease;
  }

  .docker-action:disabled {
    color: var(--text-color-disabled, color-mix(in srgb, var(--text-color-secondary) 45%, transparent));
    cursor: not-allowed;
  }

  .docker-card-expand-cell {
    display: none;
  }

  @container docker-manager-pane (max-width: 600px) {
    .docker-content-area {
      padding: 1rem;
    }

    .docker-table,
    .docker-body {
      display: block;
      width: 100%;
    }

    .docker-head {
      display: none;
    }

    .docker-row {
      display: block;
      margin-bottom: 1rem;
      overflow: hidden;
      border-radius: 0.25rem;
    }

    .docker-row > .docker-cell {
      position: relative;
      display: block;
      min-width: 0;
      padding-left: 50%;
      border-bottom: 1px dashed color-mix(in srgb, var(--border-color) 65%, transparent);
      text-align: right;
    }

    .docker-row > .docker-cell::before {
      content: attr(data-label);
      position: absolute;
      left: 0.75rem;
      width: calc(50% - 1.5rem);
      min-width: 0;
      padding-right: 0.625rem;
      overflow: hidden;
      color: var(--text-color-secondary);
      font-weight: 600;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .docker-expand-cell {
      display: none;
    }

    .docker-actions-cell {
      padding-left: 0.75rem !important;
    }

    .docker-actions-cell::before {
      display: none;
    }

    .docker-actions {
      justify-content: flex-end;
      padding-top: 0.35rem;
    }

    .docker-card-expand-cell {
      display: block;
      width: 100%;
      padding: 0;
      border-top: 1px solid var(--border-color);
    }

    .docker-card-toggle {
      width: 100%;
      height: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.375rem;
      border: 0;
      border-radius: 0 0 0.25rem 0.25rem;
      color: var(--text-color-secondary);
      background: transparent;
      font-size: 0.875rem;
      transition:
        color 0.15s ease,
        background 0.15s ease;
    }

    .docker-card-toggle:hover {
      color: var(--text-color);
      background: color-mix(in srgb, var(--header-bg-color) 50%, transparent);
    }

    .docker-detail-row {
      display: none;
    }
  }

  @container docker-manager-pane (max-width: 320px) {
    .docker-content-area {
      padding: 0.65rem;
    }

    .docker-row > .docker-cell {
      padding-left: 0.75rem;
      text-align: left;
    }

    .docker-row > .docker-cell::before {
      position: static;
      display: block;
      width: auto;
      margin-bottom: 0.2rem;
      padding-right: 0;
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
