<script setup lang="ts">
  import { computed, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseSelect, BaseTextarea } from '@/foundation/ui';
  import { ConnectionTagPicker, connectionTagsService } from '@/features/tags/public';
  import { SshKeySelector, useSshKeys } from '@/features/ssh-keys/public';
  import { useProxies } from '@/features/proxies/public';
  import { connectionsApi } from '../api/connectionsApi';
  import { useConnections } from '../composables/useConnections';
  import type { Connection, ConnectionAuthMethod, ConnectionInput, ConnectionType } from '../model/connection';

  const props = defineProps<{ connection?: Connection | null; loading?: boolean }>();
  const emit = defineEmits<{
    submit: [input: ConnectionInput | Partial<ConnectionInput>];
    submitMany: [inputs: ConnectionInput[]];
    cancel: [];
    delete: [];
  }>();
  const { t } = useI18n();
  const proxies = useProxies();
  const sshKeys = useSshKeys();
  const connections = useConnections();
  const scriptMode = ref(false);
  const script = ref('');
  const testing = ref(false);
  const testMessage = ref('');
  const submitError = ref('');
  const remoteAppEnabled = ref(false);
  const form = reactive({
    name: '',
    type: 'SSH' as ConnectionType,
    host: '',
    port: 22,
    username: '',
    authMethod: 'password' as ConnectionAuthMethod,
    password: '',
    keySource: 'saved' as 'saved' | 'direct',
    privateKey: '',
    passphrase: '',
    sshKeyId: null as number | null,
    proxyId: null as number | null,
    route: null as 'proxy' | 'jump' | null,
    tagIds: [] as number[],
    notes: '',
    jumpChain: [] as number[],
    remoteApp: '',
    remoteAppDirectory: '',
    remoteAppArguments: '',
  });
  const resetFrom = (c?: Connection | null) => {
    Object.assign(
      form,
      c
        ? {
            name: c.name ?? '',
            type: c.type,
            host: c.host,
            port: c.port,
            username: c.username,
            authMethod: c.authMethod,
            password: '',
            keySource: c.authMethod === 'key' && c.sshKeyId === null ? 'direct' : 'saved',
            privateKey: '',
            passphrase: '',
            sshKeyId: c.sshKeyId,
            proxyId: c.proxyId,
            route: c.route,
            tagIds: [...c.tagIds],
            notes: c.notes ?? '',
            jumpChain: c.jumpChain ? [...c.jumpChain] : [],
            remoteApp: c.rdpOptions?.remoteApp ?? '',
            remoteAppDirectory: c.rdpOptions?.remoteAppDirectory ?? '',
            remoteAppArguments: c.rdpOptions?.remoteAppArguments ?? '',
          }
        : {
            name: '',
            type: 'SSH',
            host: '',
            port: 22,
            username: '',
            authMethod: 'password',
            password: '',
            keySource: 'saved',
            privateKey: '',
            passphrase: '',
            sshKeyId: null,
            proxyId: null,
            route: null,
            tagIds: [],
            notes: '',
            jumpChain: [],
            remoteApp: '',
            remoteAppDirectory: '',
            remoteAppArguments: '',
          },
    );
    remoteAppEnabled.value = Boolean(c?.rdpOptions?.remoteApp);
    scriptMode.value = false;
    script.value = '';
    testMessage.value = '';
    submitError.value = '';
  };
  watch(() => props.connection, resetFrom, { immediate: true });
  watch(
    () => form.type,
    (type) => {
      if (!props.connection) {
        form.port = type === 'SSH' ? 22 : type === 'RDP' ? 3389 : 5900;
      }
      if (type !== 'SSH') {
        form.authMethod = 'password';
        form.route = null;
        form.proxyId = null;
        form.jumpChain = [];
      }
    },
  );
  onMounted(() => Promise.all([proxies.load(), sshKeys.load(), connections.load()]));
  const regularInput = (): ConnectionInput => ({
    name: form.name || null,
    type: form.type,
    host: form.host.trim(),
    port: Number(form.port),
    username: form.username.trim(),
    authMethod: form.type === 'SSH' ? form.authMethod : 'password',
    ...(form.password ? { password: form.password } : {}),
    ...(form.type === 'SSH' && form.authMethod === 'key' && form.keySource === 'direct' && form.privateKey
      ? { privateKey: form.privateKey, passphrase: form.passphrase || undefined }
      : {}),
    sshKeyId: form.type === 'SSH' && form.authMethod === 'key' && form.keySource === 'saved' ? form.sshKeyId : null,
    proxyId: form.route === 'proxy' ? form.proxyId : null,
    route: form.route,
    tagIds: [...form.tagIds],
    notes: form.notes || null,
    jumpChain: form.route === 'jump' ? [...form.jumpChain] : null,
    rdpOptions:
      form.type === 'RDP' && remoteAppEnabled.value
        ? {
            remoteApp: form.remoteApp,
            remoteAppDirectory: form.remoteAppDirectory || null,
            remoteAppArguments: form.remoteAppArguments || null,
          }
        : null,
  });
  const parseIpv4Range = (value: string): string[] | null => {
    if (!value.includes('~')) return null;
    const parts = value.split('~').map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(t('connections.form.errorInvalidIpRangeFormat'));
    const parse = (ip: string) => {
      const segments = ip.split('.');
      if (segments.length !== 4 || segments.some((part) => !/^\d+$/.test(part)))
        throw new Error(t('connections.form.errorInvalidIpFormat'));
      const numbers = segments.map(Number);
      if (numbers.some((part) => part < 0 || part > 255)) throw new Error(t('connections.form.errorInvalidIpSuffix'));
      return numbers;
    };
    const start = parse(parts[0]);
    const end = parse(parts[1]);
    if (start.slice(0, 3).join('.') !== end.slice(0, 3).join('.'))
      throw new Error(t('connections.form.errorIpRangeNotSameSubnet'));
    if (start[3]! > end[3]!) throw new Error(t('connections.form.errorIpRangeStartAfterEnd'));
    const prefix = start.slice(0, 3).join('.');
    return Array.from({ length: end[3]! - start[3]! + 1 }, (_, index) => `${prefix}.${start[3]! + index}`);
  };
  const validateRegular = () => {
    if (!form.host.trim() || !form.username.trim()) throw new Error(t('connections.form.errorRequiredFields'));
    const port = Number(form.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(t('connections.form.errorPort'));

    const current = props.connection;
    if (form.type === 'SSH') {
      if (form.authMethod === 'password') {
        const canPreserve = Boolean(current && current.type === 'SSH' && current.authMethod === 'password');
        if (!form.password && !canPreserve)
          throw new Error(
            t(current ? 'connections.form.errorPasswordRequiredOnSwitch' : 'connections.form.errorPasswordRequired'),
          );
      } else if (form.keySource === 'saved') {
        const canPreserveSaved = Boolean(
          current && current.type === 'SSH' && current.authMethod === 'key' && current.sshKeyId !== null,
        );
        if (!form.sshKeyId && !canPreserveSaved)
          throw new Error(
            t(current ? 'connections.form.errorSshKeyRequiredOnSwitch' : 'connections.form.errorSshKeyRequired'),
          );
      } else {
        const canPreserveDirect = Boolean(
          current && current.type === 'SSH' && current.authMethod === 'key' && current.sshKeyId === null,
        );
        if (!form.privateKey && !canPreserveDirect)
          throw new Error(
            t(
              current ? 'connections.form.errorPrivateKeyRequiredOnSwitch' : 'connections.form.errorPrivateKeyRequired',
            ),
          );
      }
    } else {
      const canPreserve = Boolean(current && !(current.type === 'SSH' && current.authMethod === 'key'));
      if (!form.password && !canPreserve)
        throw new Error(
          t(
            form.type === 'VNC'
              ? 'connections.form.errorVncPasswordRequired'
              : 'connections.form.errorPasswordRequired',
          ),
        );
    }

    if (form.type === 'RDP' && remoteAppEnabled.value && !form.remoteApp.trim())
      throw new Error(t('connections.form.errorRemoteAppAliasRequired'));
  };

  const submitRegular = () => {
    submitError.value = '';
    try {
      validateRegular();
      const hosts = parseIpv4Range(form.host);
      if (props.connection && hosts) throw new Error(t('connections.form.errorIpRangeNotAllowedInEditMode'));
      if (!props.connection && hosts) {
        if (!hosts.length) throw new Error(t('connections.form.errorIpRangeEmpty'));
        const base = regularInput();
        emit(
          'submitMany',
          hosts.map((host) => ({
            ...base,
            host,
            name: form.name ? `${form.name}-${host.split('.').at(-1)}` : host,
          })),
        );
        return;
      }
      const input = regularInput();
      if (props.connection) {
        const update: Partial<ConnectionInput> = { ...input };
        if (!form.password) delete update.password;
        if (form.type === 'SSH' && form.authMethod === 'key' && form.keySource === 'direct') {
          const preservingDirect = props.connection.authMethod === 'key' && props.connection.sshKeyId === null;
          if (!form.privateKey) {
            delete update.privateKey;
            if (!form.passphrase) delete update.passphrase;
            if (preservingDirect) delete update.sshKeyId;
          }
        }
        emit('submit', update);
      } else emit('submit', input);
    } catch (cause) {
      submitError.value = cause instanceof Error ? cause.message : String(cause);
    }
  };
  const test = async () => {
    testing.value = true;
    testMessage.value = '';
    try {
      if (form.host.includes('~')) throw new Error(t('connections.form.errorIpRangeNotAllowedInEditMode'));
      if (!props.connection) validateRegular();
      const r = props.connection
        ? await connectionsApi.test(props.connection.id)
        : await connectionsApi.testUnsaved(regularInput());
      testMessage.value = r.message;
    } catch (cause) {
      testMessage.value = apiErrorMessage(cause, t('connections.test.errorUnknown'));
    } finally {
      testing.value = false;
    }
  };
  const tokenize = (line: string) =>
    [...(line.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g) ?? [])].map((x) => x.replace(/^("|')|("|')$/g, ''));
  const parseLine = async (line: string): Promise<ConnectionInput> => {
    const tokens = tokenize(line);
    const first = tokens.shift();
    if (!first || !first.includes('@')) throw new Error(t('connections.form.scriptErrorMissingHost', { line }));
    const at = first.indexOf('@');
    const username = first.slice(0, at);
    const hostPort = first.slice(at + 1);
    const colon = hostPort.lastIndexOf(':');
    let host = hostPort;
    let port = 22;
    if (colon > 0 && /^\d+$/.test(hostPort.slice(colon + 1))) {
      host = hostPort.slice(0, colon);
      port = Number(hostPort.slice(colon + 1));
    }
    let type: ConnectionType = 'SSH',
      name = `${username}@${host}`,
      password = '',
      keyName = '',
      proxyName = '',
      notes = '';
    const tagNames: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const value = tokens[i + 1];
      if (token === '-type') {
        type = value?.toUpperCase() as ConnectionType;
        i++;
      } else if (token === '-name') {
        name = value ?? name;
        i++;
      } else if (token === '-p') {
        password = value ?? '';
        i++;
      } else if (token === '-k') {
        keyName = value ?? '';
        i++;
      } else if (token === '-proxy') {
        proxyName = value ?? '';
        i++;
      } else if (token === '-note') {
        notes = value ?? '';
        i++;
      } else if (token === '-tags') {
        for (i++; i < tokens.length && !tokens[i]?.startsWith('-'); i++)
          tagNames.push(...(tokens[i] ?? '').split(',').filter(Boolean));
        i--;
      } else throw new Error(t('connections.form.scriptErrorUnknownOption', { option: token }));
    }
    if (!['SSH', 'RDP', 'VNC'].includes(type))
      throw new Error(t('connections.form.scriptErrorInvalidType', { type, line }));
    if (!Number.isInteger(port) || port <= 0 || port > 65535)
      throw new Error(t('connections.form.scriptErrorInvalidPort', { port, line }));
    if (type === 'SSH' && !password && !keyName) throw new Error(t('connections.form.scriptErrorMissingAuthForSsh'));
    if (type === 'RDP' && !password) throw new Error(t('connections.form.scriptErrorMissingPasswordForRdp'));
    if (type === 'VNC' && !password) throw new Error(t('connections.form.scriptErrorMissingPasswordForVnc'));
    if (type === 'RDP' && keyName) throw new Error(t('connections.form.scriptErrorKeyNotApplicableForRdp'));
    if (type === 'VNC' && keyName) throw new Error(t('connections.form.scriptErrorKeyNotApplicableForVnc'));
    const tags = await connectionTagsService.ensure(tagNames);
    let sshKeyId: number | null = null;
    if (keyName) {
      await sshKeys.load(true);
      sshKeyId = sshKeys.keys.value.find((k) => k.name === keyName)?.id ?? null;
      if (!sshKeyId) throw new Error(t('connections.form.scriptErrorSshKeyNotFound', { keyName }));
    }
    let proxyId: number | null = null;
    if (proxyName) {
      await proxies.load(true);
      proxyId = proxies.proxies.value.find((p) => p.name === proxyName)?.id ?? null;
      if (!proxyId) throw new Error(t('connections.form.scriptErrorProxyNotFound', { proxyName }));
    }
    return {
      name,
      type,
      host,
      port: type === 'SSH' ? port : type === 'RDP' ? (colon > 0 ? port : 3389) : colon > 0 ? port : 5900,
      username,
      authMethod: keyName ? 'key' : 'password',
      ...(password && !keyName ? { password } : {}),
      sshKeyId,
      proxyId,
      route: proxyId ? 'proxy' : null,
      tagIds: tags.map((x) => x.id),
      notes: notes || null,
      rdpOptions: null,
    };
  };
  const submit = async () => {
    if (!scriptMode.value) {
      submitRegular();
      return;
    }
    submitError.value = '';
    try {
      const lines = script.value
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (!lines.length) throw new Error(t('connections.form.scriptModeEmpty'));
      const inputs: ConnectionInput[] = [];
      for (const line of lines) inputs.push(await parseLine(line));
      emit('submitMany', inputs);
    } catch (cause) {
      submitError.value = cause instanceof Error ? cause.message : String(cause);
    }
  };
  const availableJumpHosts = computed(() =>
    connections.connections.value.filter(
      (connection) => connection.type === 'SSH' && connection.id !== props.connection?.id,
    ),
  );
  const jumpHostsForIndex = (index: number) =>
    availableJumpHosts.value.filter(
      (connection) => !form.jumpChain.some((id, chainIndex) => chainIndex !== index && id === connection.id),
    );
  const addJumpHost = () => {
    const used = new Set(form.jumpChain);
    const next = availableJumpHosts.value.find((connection) => !used.has(connection.id));
    if (next) form.jumpChain.push(next.id);
  };
  const removeJumpHost = (index: number) => form.jumpChain.splice(index, 1);
</script>

<template>
  <form data-testid="connection-form" class="flex max-h-[78vh] min-h-0 flex-col" @submit.prevent="submit">
    <h3 class="mb-6 shrink-0 text-center text-xl font-semibold">
      {{ connection ? t('connections.form.titleEdit') : t('connections.form.title') }}
    </h3>

    <div class="flex-grow space-y-6 overflow-y-auto pr-2">
      <template v-if="!scriptMode">
        <section class="space-y-4 rounded-md border border-border bg-header/30 p-4">
          <h4 class="mb-3 border-b border-border/50 pb-2 text-base font-semibold">
            {{ t('connections.form.sectionBasic') }}
          </h4>
          <BaseFormField :label="`${t('connections.form.name')} (${t('connections.form.optional')})`">
            <BaseInput id="conn-name" v-model="form.name" />
          </BaseFormField>
          <div>
            <label class="mb-1 block text-sm font-medium text-text-secondary">{{
              t('connections.form.connectionType')
            }}</label>
            <div class="flex rounded-md shadow-sm">
              <button
                data-testid="connection-type-ssh"
                type="button"
                class="flex-1 rounded-l-md border border-border px-3 py-2 text-sm font-medium focus:outline-none"
                :class="form.type === 'SSH' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border'"
                @click="form.type = 'SSH'"
              >
                SSH
              </button>
              <button
                data-testid="connection-type-rdp"
                type="button"
                class="-ml-px flex-1 border-y border-r border-border px-3 py-2 text-sm font-medium focus:outline-none"
                :class="form.type === 'RDP' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border'"
                @click="form.type = 'RDP'"
              >
                RDP
              </button>
              <button
                data-testid="connection-type-vnc"
                type="button"
                class="-ml-px flex-1 rounded-r-md border border-border px-3 py-2 text-sm font-medium focus:outline-none"
                :class="form.type === 'VNC' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border'"
                @click="form.type = 'VNC'"
              >
                VNC
              </button>
            </div>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <BaseFormField :label="t('connections.form.host')" class="md:col-span-2">
              <BaseInput id="conn-host" v-model="form.host" required />
              <p v-if="!connection" class="mt-1 text-xs text-text-secondary">
                <i class="fas fa-exclamation-circle mr-1" aria-hidden="true" />{{ t('connections.form.hostTooltip') }}
              </p>
            </BaseFormField>
            <BaseFormField :label="t('connections.form.port')">
              <BaseInput id="conn-port" v-model="form.port" type="number" min="1" max="65535" required />
            </BaseFormField>
          </div>
        </section>

        <section class="space-y-4 rounded-md border border-border bg-header/30 p-4">
          <h4 class="mb-3 border-b border-border/50 pb-2 text-base font-semibold">
            {{ t('connections.form.sectionAuth') }}
          </h4>
          <BaseFormField :label="t('connections.form.username')">
            <BaseInput id="conn-username" v-model="form.username" required />
          </BaseFormField>

          <template v-if="form.type === 'SSH'">
            <div>
              <label class="mb-1 block text-sm font-medium text-text-secondary">{{
                t('connections.form.authMethod')
              }}</label>
              <div class="flex rounded-md shadow-sm">
                <button
                  type="button"
                  class="flex-1 rounded-l-md border border-border px-3 py-2 text-sm font-medium focus:outline-none"
                  :class="
                    form.authMethod === 'password'
                      ? 'bg-primary text-white'
                      : 'bg-background text-foreground hover:bg-border'
                  "
                  @click="form.authMethod = 'password'"
                >
                  {{ t('connections.form.authMethodPassword') }}
                </button>
                <button
                  type="button"
                  class="-ml-px flex-1 rounded-r-md border border-border px-3 py-2 text-sm font-medium focus:outline-none"
                  :class="
                    form.authMethod === 'key'
                      ? 'bg-primary text-white'
                      : 'bg-background text-foreground hover:bg-border'
                  "
                  @click="form.authMethod = 'key'"
                >
                  {{ t('connections.form.authMethodKey') }}
                </button>
              </div>
            </div>
            <BaseFormField v-if="form.authMethod === 'password'" :label="t('connections.form.password')">
              <BaseInput id="conn-password" v-model="form.password" type="password" autocomplete="new-password" />
            </BaseFormField>
            <div v-else class="space-y-4">
              <div>
                <label class="mb-1 block text-sm font-medium text-text-secondary">{{
                  t('connections.form.sshKey')
                }}</label>
                <div class="mb-3 flex rounded-md shadow-sm">
                  <button
                    type="button"
                    class="flex-1 rounded-l-md border border-border px-3 py-2 text-sm font-medium"
                    :class="
                      form.keySource === 'saved'
                        ? 'bg-primary text-white'
                        : 'bg-background text-foreground hover:bg-border'
                    "
                    @click="form.keySource = 'saved'"
                  >
                    {{ t('connections.form.keySourceSaved') }}
                  </button>
                  <button
                    type="button"
                    class="-ml-px flex-1 rounded-r-md border border-border px-3 py-2 text-sm font-medium"
                    :class="
                      form.keySource === 'direct'
                        ? 'bg-primary text-white'
                        : 'bg-background text-foreground hover:bg-border'
                    "
                    @click="form.keySource = 'direct'"
                  >
                    {{ t('connections.form.keySourceDirect') }}
                  </button>
                </div>
                <template v-if="form.keySource === 'saved'">
                  <SshKeySelector v-model="form.sshKeyId" />
                  <p v-if="connection && connection.authMethod === 'key'" class="mt-1 text-xs text-text-secondary">
                    {{ t('connections.form.keyUpdateNoteSelected') }}
                  </p>
                </template>
                <template v-else>
                  <BaseFormField :label="t('connections.form.privateKeyDirect')">
                    <BaseTextarea v-model="form.privateKey" rows="6" autocomplete="off" class="font-mono text-sm" />
                  </BaseFormField>
                  <BaseFormField :label="t('connections.form.passphrase')" class="mt-3">
                    <BaseInput v-model="form.passphrase" type="password" autocomplete="new-password" />
                  </BaseFormField>
                  <p
                    v-if="connection && connection.authMethod === 'key' && connection.sshKeyId === null"
                    class="mt-1 text-xs text-text-secondary"
                  >
                    {{ t('connections.form.keyUpdateNoteDirect') }}
                  </p>
                </template>
              </div>
            </div>
          </template>
          <BaseFormField
            v-else
            :label="form.type === 'RDP' ? t('connections.form.password') : t('connections.form.vncPassword')"
          >
            <BaseInput
              :id="form.type === 'RDP' ? 'conn-password-rdp' : 'conn-password-vnc'"
              v-model="form.password"
              type="password"
              autocomplete="new-password"
            />
          </BaseFormField>
        </section>

        <section class="space-y-4 rounded-md border border-border bg-header/30 p-4">
          <h4 class="mb-3 border-b border-border/50 pb-2 text-base font-semibold">
            {{ t('connections.form.sectionAdvanced') }}
          </h4>
          <template v-if="form.type === 'SSH'">
            <div>
              <label class="mb-1 block text-sm font-medium text-text-secondary">{{
                t('connections.form.connectionMode')
              }}</label>
              <div class="mb-4 flex rounded-md shadow-sm">
                <button
                  type="button"
                  class="flex-1 rounded-l-md border border-border px-3 py-2 text-sm font-medium"
                  :class="
                    form.route === null ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border'
                  "
                  @click="form.route = null"
                >
                  {{ t('connections.form.connectionModeDirect') }}
                </button>
                <button
                  type="button"
                  class="-ml-px flex-1 border border-border px-3 py-2 text-sm font-medium"
                  :class="
                    form.route === 'proxy' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border'
                  "
                  @click="form.route = 'proxy'"
                >
                  {{ t('connections.form.connectionModeProxy') }}
                </button>
                <button
                  type="button"
                  class="-ml-px flex-1 rounded-r-md border border-border px-3 py-2 text-sm font-medium"
                  :class="
                    form.route === 'jump' ? 'bg-primary text-white' : 'bg-background text-foreground hover:bg-border'
                  "
                  @click="form.route = 'jump'"
                >
                  {{ t('connections.form.connectionModeJumpHost') }}
                </button>
              </div>
            </div>
            <BaseFormField
              v-if="form.route === 'proxy'"
              :label="`${t('connections.form.proxy')} (${t('connections.form.optional')})`"
            >
              <BaseSelect v-model="form.proxyId">
                <option :value="null">{{ t('connections.form.noProxy') }}</option>
                <option v-for="proxy in proxies.proxies.value" :key="proxy.id" :value="proxy.id">
                  {{ proxy.name }} ({{ proxy.type }} - {{ proxy.host }}:{{ proxy.port }})
                </option>
              </BaseSelect>
            </BaseFormField>
            <div v-if="form.route === 'jump'" class="space-y-3">
              <label class="mb-1 block text-sm font-medium text-text-secondary">{{
                t('connections.form.jumpHostsTitle')
              }}</label>
              <div
                v-for="(jumpHostId, index) in form.jumpChain"
                :key="index"
                class="flex items-center space-x-2 rounded-md border border-border bg-background/50 p-2"
              >
                <span class="whitespace-nowrap text-sm font-medium text-text-secondary"
                  >{{ t('connections.form.jumpHostLabel') }} {{ index + 1 }}:</span
                >
                <BaseSelect v-model="form.jumpChain[index]" class="min-w-0 flex-1">
                  <option v-for="host in jumpHostsForIndex(index)" :key="host.id" :value="host.id">
                    {{ host.name || host.host }}
                  </option>
                </BaseSelect>
                <button
                  type="button"
                  class="rounded-md p-1.5 text-error hover:opacity-80"
                  :title="t('connections.form.removeJumpHostTitle')"
                  @click="removeJumpHost(index)"
                >
                  <i class="fas fa-times" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                class="flex w-full items-center justify-center space-x-2 rounded-md border border-dashed border-primary px-3 py-2 text-primary hover:bg-primary/10 disabled:opacity-50"
                :disabled="form.jumpChain.length >= availableJumpHosts.length"
                @click="addJumpHost"
              >
                <i class="fas fa-plus" aria-hidden="true" /><span>{{ t('connections.form.addJumpHost') }}</span>
              </button>
              <p v-if="availableJumpHosts.length === 0" class="rounded-md bg-warning/20 p-2 text-xs text-warning">
                {{ t('connections.form.noAvailableSshConnectionsForJump') }}
              </p>
            </div>
          </template>

          <div
            v-if="form.type === 'RDP'"
            data-testid="rdp-advanced-options"
            class="space-y-3 rounded-md border border-border/70 bg-background/50 p-3"
          >
            <button
              type="button"
              role="switch"
              data-testid="rdp-remote-app-toggle"
              :aria-checked="remoteAppEnabled"
              class="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm font-medium"
              @click="remoteAppEnabled = !remoteAppEnabled"
            >
              <span>{{ t('connections.form.remoteAppEnabled') }}</span>
              <span
                aria-hidden="true"
                class="relative h-5 w-9 shrink-0 rounded-full border border-border transition-colors"
                :class="remoteAppEnabled ? 'bg-primary' : 'bg-border/60'"
                ><span
                  class="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                  :class="remoteAppEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'"
              /></span>
            </button>
            <div v-if="remoteAppEnabled" data-testid="rdp-remote-app-fields" class="space-y-3">
              <BaseFormField :label="t('connections.form.remoteAppAlias')"
                ><BaseInput v-model="form.remoteApp" data-testid="rdp-remote-app-alias"
              /></BaseFormField>
              <BaseFormField :label="`${t('connections.form.remoteAppDir')} (${t('connections.form.optional')})`"
                ><BaseInput v-model="form.remoteAppDirectory" data-testid="rdp-remote-app-dir"
              /></BaseFormField>
              <BaseFormField :label="`${t('connections.form.remoteAppArgs')} (${t('connections.form.optional')})`"
                ><BaseInput v-model="form.remoteAppArguments" data-testid="rdp-remote-app-args"
              /></BaseFormField>
            </div>
          </div>

          <BaseFormField :label="`${t('connections.form.tags')} (${t('connections.form.optional')})`"
            ><ConnectionTagPicker v-model="form.tagIds"
          /></BaseFormField>
          <BaseFormField :label="t('connections.form.notes')"
            ><BaseTextarea
              id="conn-notes"
              v-model="form.notes"
              rows="3"
              :placeholder="t('connections.form.notesPlaceholder')"
          /></BaseFormField>
        </section>
      </template>

      <section v-if="!connection" class="mt-6 space-y-4 rounded-md border border-border bg-header/30 p-4">
        <div class="flex items-center justify-between">
          <h4 class="text-base font-semibold">{{ t('connections.form.sectionScriptMode') }}</h4>
          <button
            data-testid="connection-script-toggle"
            type="button"
            role="switch"
            :aria-label="t('connections.form.sectionScriptMode')"
            :aria-checked="scriptMode"
            class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            :class="scriptMode ? 'bg-primary' : 'bg-gray-300'"
            @click="scriptMode = !scriptMode"
          >
            <span
              aria-hidden="true"
              class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
              :class="scriptMode ? 'translate-x-5' : 'translate-x-0'"
            />
          </button>
        </div>
        <div v-if="scriptMode" class="mt-4">
          <BaseTextarea
            id="conn-script-input"
            v-model="script"
            rows="10"
            class="font-mono"
            :placeholder="t('connections.form.scriptModePlaceholder')"
          />
          <p class="mt-1 whitespace-pre-line text-xs text-text-secondary">
            {{ t('connections.form.scriptModeFormatInfo') }}
          </p>
        </div>
      </section>

      <p
        v-if="submitError"
        class="rounded-md border border-error/30 bg-error/10 p-3 text-center text-sm font-medium text-error"
      >
        {{ submitError }}
      </p>
    </div>

    <footer class="mt-6 flex shrink-0 items-center justify-between border-t border-border/50 pt-5">
      <div v-if="!scriptMode && form.type === 'SSH'" class="flex flex-col items-start gap-1">
        <div class="flex items-center gap-2">
          <BaseButton data-testid="connection-test-button" type="button" size="sm" :loading="testing" @click="test">{{
            t('connections.form.testConnection')
          }}</BaseButton>
          <span class="group relative"
            ><i class="fas fa-info-circle cursor-help text-text-secondary" aria-hidden="true" /><span
              class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-xs -translate-x-1/2 rounded bg-gray-800 p-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
              >{{ t('connections.test.latencyTooltip') }}</span
            ></span
          >
        </div>
        <p v-if="testMessage" class="min-h-[1.2em] pl-1 text-xs text-text-secondary">{{ testMessage }}</p>
      </div>
      <div v-else class="flex-1" />
      <div class="flex space-x-3">
        <BaseButton
          v-if="connection && !scriptMode"
          data-testid="connection-delete-button"
          type="button"
          variant="danger"
          :disabled="loading || testing"
          @click="emit('delete')"
          >{{ t('connections.actions.delete') }}</BaseButton
        >
        <BaseButton
          data-testid="connection-submit-button"
          type="submit"
          variant="primary"
          :loading="loading"
          :disabled="testing"
          >{{ connection ? t('connections.form.confirmEdit') : t('connections.form.confirm') }}</BaseButton
        >
        <BaseButton type="button" :disabled="loading || testing" @click="emit('cancel')">{{
          t('connections.form.cancel')
        }}</BaseButton>
      </div>
    </footer>
  </form>
</template>
