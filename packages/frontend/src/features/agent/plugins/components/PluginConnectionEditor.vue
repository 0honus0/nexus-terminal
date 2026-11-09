<script setup lang="ts">
	import { computed, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput, UiInlineNotice, UiSelect, UiTextarea } from '@/foundation/ui';
	import { useConnections } from '@/features/connections/public';
	import { useAgentManagementOperation } from '../../composables/use-agent-management-operation';
	import { readPluginConnection, writePluginConnection } from '../api/plugin-connection-api';
	import type { PluginConnection, PluginConnector } from '../model/plugin-connection-types';

	const props = defineProps<{ appId: string; instanceId: string; kinds: ('http' | 'remoteProcess')[] }>();
	const emit = defineEmits<{ saved: [] }>();
	const { t } = useI18n();
	const operation = useAgentManagementOperation(undefined, undefined, { notifyFailureDetails: true });
	const connections = useConnections();
	const original = ref<PluginConnection | null>(null);
	const kind = ref<'none' | 'http' | 'remoteProcess'>('none');
	const endpoint = ref('');
	const privateHosts = ref('');
	const connectionId = ref(0);
	const cwd = ref('/');
	const argv = ref('[]');
	const credentialAction = ref<'keep' | 'clear' | 'replace'>('keep');
	const credential = ref('');
	const targets = computed(() => connections.connections.value.filter((target) => target.type === 'SSH'));
	const kinds = computed(() => [
		{ value: 'none', label: t('agent.settings.plugins.settings.noConnection') },
		...props.kinds.map((value) => ({ value, label: value === 'http' ? 'HTTP' : 'SSH' })),
	]);

	function accept(value: PluginConnection): void {
		original.value = value;
		kind.value = value.connector.kind;
		credentialAction.value = 'keep';
		credential.value = '';
		if (value.connector.kind === 'http') {
			endpoint.value = value.connector.endpoint;
			privateHosts.value = value.connector.privateAuthorities.join('\n');
		}
		if (value.connector.kind === 'remoteProcess') {
			connectionId.value = value.connector.connectionId;
			cwd.value = value.connector.cwd;
			argv.value = JSON.stringify(value.connector.argv);
		}
	}

	async function load(): Promise<void> {
		await operation.execute((signal) => readPluginConnection(props.appId, props.instanceId, signal), accept, {
			write: false,
		});
	}

	async function save(): Promise<void> {
		if (!original.value || operation.refreshRequired.value) return;
		let connector: PluginConnector;
		if (kind.value === 'http') {
			connector = {
				kind: 'http',
				endpoint: endpoint.value,
				privateAuthorities: privateHosts.value
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean),
			};
		} else if (kind.value === 'remoteProcess') {
			let value: unknown;
			try {
				value = JSON.parse(argv.value);
			} catch (cause) {
				operation.reportFailure(cause);
				return;
			}
			if (!Array.isArray(value) || !value.every((arg): arg is string => typeof arg === 'string')) {
				operation.reportFailure(new Error('Invalid command arguments'));
				return;
			}
			connector = {
				kind: 'remoteProcess',
				connectionId: connectionId.value,
				argv: value.map((arg) => arg),
				cwd: cwd.value,
			};
		} else {
			connector = { kind: 'none' };
		}
		const command = {
			expectedRevision: original.value.revision,
			connector,
			credential:
				kind.value !== 'http' || credentialAction.value === 'clear'
					? { action: 'clear' as const }
					: credentialAction.value === 'replace'
						? { action: 'replace' as const, value: credential.value }
						: { action: 'keep' as const },
		};
		await operation.execute(
			(signal) => writePluginConnection(props.appId, props.instanceId, command, signal),
			(value) => {
				accept(value);
				emit('saved');
			},
			{ write: true },
		);
	}

	onMounted(() => {
		void load();
		void connections.load().catch((cause: unknown) => operation.reportFailure(cause));
	});
</script>

<template>
	<form class="ui-form-section space-y-4" @submit.prevent="save">
		<h4>{{ t('agent.settings.plugins.settings.connection') }}</h4>
		<UiInlineNotice v-if="operation.recoveryRequired.value" tone="warning" compact>
			{{ t('agent.settings.integrationManagement.reload') }}
			<template #actions
				><UiButton :disabled="operation.busy.value" @click="load">{{
					t('agent.settings.plugins.settings.reload')
				}}</UiButton></template
			>
		</UiInlineNotice>
		<fieldset :disabled="operation.busy.value || operation.refreshRequired.value" class="space-y-4">
			<UiFormField :for-id="`${instanceId}-kind`" :label="t('agent.settings.integrationManagement.kind')"
				><UiSelect :id="`${instanceId}-kind`" v-model="kind" :options="kinds"
			/></UiFormField>
			<template v-if="kind === 'http'">
				<UiFormField
					:for-id="`${instanceId}-endpoint`"
					:label="t('agent.settings.integrationManagement.endpoint')"
					><UiInput :id="`${instanceId}-endpoint`" v-model="endpoint" type="url" required autocomplete="off"
				/></UiFormField>
				<UiFormField
					:for-id="`${instanceId}-privateHosts`"
					:label="t('agent.settings.integrationManagement.privateHosts')"
					><UiTextarea :id="`${instanceId}-privateHosts`" v-model="privateHosts" :min-rows="2"
				/></UiFormField>
				<UiFormField
					:for-id="`${instanceId}-credentialAction`"
					:label="t('agent.settings.integrationManagement.credential')"
				>
					<UiSelect :id="`${instanceId}-credentialAction`" v-model="credentialAction"
						><option value="keep">{{ t('agent.settings.integrationManagement.keep') }}</option>
						<option value="clear">{{ t('agent.settings.integrationManagement.clear') }}</option>
						<option value="replace">
							{{ t('agent.settings.integrationManagement.replace') }}
						</option></UiSelect
					>
				</UiFormField>
				<UiInput
					v-if="credentialAction === 'replace'"
					v-model="credential"
					type="password"
					required
					autocomplete="new-password"
					:aria-label="t('agent.settings.integrationManagement.credential')"
				/>
			</template>
			<template v-else-if="kind === 'remoteProcess'">
				<UiFormField
					:for-id="`${instanceId}-connectionId`"
					:label="t('agent.settings.integrationManagement.connection')"
					><UiSelect :id="`${instanceId}-connectionId`" v-model="connectionId"
						><option :value="0">{{ t('agent.settings.integrationManagement.chooseConnection') }}</option>
						<option v-for="target in targets" :key="target.id" :value="target.id">
							{{ target.name }} · {{ target.host }}
						</option></UiSelect
					></UiFormField
				>
				<UiFormField :for-id="`${instanceId}-cwd`" :label="t('agent.settings.integrationManagement.cwd')"
					><UiInput :id="`${instanceId}-cwd`" v-model="cwd" required
				/></UiFormField>
				<UiFormField :for-id="`${instanceId}-argv`" :label="t('agent.settings.integrationManagement.argv')"
					><UiTextarea :id="`${instanceId}-argv`" v-model="argv" :min-rows="3" class="font-mono"
				/></UiFormField>
			</template>
			<div class="flex justify-end">
				<UiButton type="submit" :loading="operation.busy.value">{{ t('common.save') }}</UiButton>
			</div>
		</fieldset>
	</form>
</template>
