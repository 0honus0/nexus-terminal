<script setup lang="ts">
  import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
  import { agentApi, type PluginFrontendDescriptor } from '../api/agent-api';
  import { PluginAppBridge } from './app-bridge';
  import { PLUGIN_FRONTEND_PROTOCOL_VERSION } from './plugin-sdk';

  const props = defineProps<{ appId: string }>();
  const iframe = ref<HTMLIFrameElement | null>(null);
  const descriptor = ref<PluginFrontendDescriptor | null>(null);
  const status = ref<'loading' | 'connecting' | 'ready' | 'unavailable'>('loading');
  let bridge: PluginAppBridge | null = null;
  let generation = 0;

  const disposeBridge = (): void => {
    bridge?.close();
    bridge = null;
  };

  const load = async (): Promise<void> => {
    const current = ++generation;
    disposeBridge();
    descriptor.value = null;
    status.value = 'loading';
    try {
      const next = await agentApi.pluginFrontend(props.appId);
      if (current !== generation) return;
      if (
        next.appId !== props.appId ||
        next.sandbox !== 'allow-scripts' ||
        next.protocolVersion !== PLUGIN_FRONTEND_PROTOCOL_VERSION ||
        !next.sdkVersion ||
        next.sdkVersion.length > 128 ||
        /[\0\r\n]/.test(next.sdkVersion)
      ) {
        throw new Error('PLUGIN_FRONTEND_DESCRIPTOR_INVALID');
      }
      descriptor.value = next;
      status.value = 'connecting';
      await nextTick();
      if (current !== generation) return;
      const frame = iframe.value;
      if (!frame) throw new Error('PLUGIN_FRONTEND_FRAME_MISSING');
      const nextBridge = new PluginAppBridge(frame, props.appId, next);
      bridge = nextBridge;
      const connected = nextBridge.start();
      frame.src = next.url;
      await connected;
      if (current !== generation || bridge !== nextBridge) return;
      status.value = 'ready';
    } catch {
      if (current !== generation) return;
      disposeBridge();
      descriptor.value = null;
      status.value = 'unavailable';
    }
  };

  watch(
    () => props.appId,
    () => void load(),
    { immediate: true },
  );

  onBeforeUnmount(() => {
    generation += 1;
    disposeBridge();
  });
</script>

<template>
  <div class="relative h-full min-h-0 bg-background">
    <iframe
      v-if="descriptor"
      ref="iframe"
      class="h-full w-full border-0 bg-background"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :title="$t('agent.pluginFrontend.frameTitle')"
    ></iframe>
    <div
      v-if="status !== 'ready'"
      class="absolute inset-0 flex items-center justify-center bg-background p-6 text-center text-sm text-text-secondary"
      role="status"
    >
      <span v-if="status === 'loading'">{{ $t('agent.pluginFrontend.loading') }}</span>
      <span v-else-if="status === 'connecting'">{{ $t('agent.pluginFrontend.connecting') }}</span>
      <span v-else>{{ $t('agent.pluginFrontend.unavailable') }}</span>
    </div>
  </div>
</template>
