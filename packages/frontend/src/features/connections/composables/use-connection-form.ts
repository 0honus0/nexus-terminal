import { computed, onMounted, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthSession } from '@/features/auth/public';
import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
import { targetErrorKey } from '@/client/targets/target-types';
import { InvalidTargetPayload } from '@nexus-terminal/shared/targets/http';
import { TARGET_CONNECTION_MAX_JUMPS } from '@nexus-terminal/shared/targets/connections/values';
import { readConnectionImportInput } from '@nexus-terminal/shared/targets/connections/http-codec';
import type { TargetImportInput, TargetCredentialInput } from '@nexus-terminal/shared/targets/connections/http';
import {
	toConnectionDraft,
	toConnectionInput,
	toConnectionCredential,
	toUnsavedTest,
} from '../model/connection-mapper';
import { parseConnectionScript, expandConnectionHosts } from '../model/connection-script';
import type {
	ConnectionSummary,
	CredentialSummary,
	ConnectionSubmission,
	ConnectionTestSummary,
} from '../model/connection-types';
import { ConnectionTestFailure } from '../model/connection-errors';
import { connectionTestApi } from '../api/connection-test-api';
import { testConnectionWithHostKeyConfirmation } from '../model/connection-test';
import { useConnections } from './useConnections';

export function useConnectionForm(
	props: Readonly<{
		connection?: ConnectionSummary | null;
		credential?: CredentialSummary | null;
		loading?: boolean;
	}>,
	emit: {
		(event: 'submit', value: ConnectionSubmission): void;
		(event: 'submitMany', value: TargetImportInput[]): void;
		(event: 'credential', value: TargetCredentialInput | null): void;
	},
) {
	const { t } = useI18n();
	const capabilities = useRuntimeFeatureCapabilities();
	const connections = useConnections();
	const auth = useAuthSession();
	const proxies = capabilities.proxies;
	const sshKeys = capabilities.sshKeys;
	const form = ref(toConnectionDraft(props.connection ?? null));
	const scriptMode = ref(false);
	const script = ref('');
	const testing = ref(false);
	const parsing = ref(false);
	const testResult = ref<ConnectionTestSummary | null>(null);
	const submitError = ref('');
	let generation = 0;
	let controller = new AbortController();

	function reset(): void {
		generation++;
		controller.abort();
		controller = new AbortController();
		form.value = toConnectionDraft(props.connection ?? null);
		if (props.credential?.credential.kind === 'ssh_key') {
			form.value.authMethod = 'key';
			form.value.sshKeyId = props.credential.credential.sshKeyId;
		}
		scriptMode.value = false;
		script.value = '';
		testing.value = false;
		parsing.value = false;
		testResult.value = null;
		submitError.value = '';
	}

	watch(() => props.connection, reset, { immediate: true });
	watch(
		() => form.value.type,
		(type) => {
			if (!props.connection) {
				form.value.port = type === 'SSH' ? 22 : type === 'RDP' ? 3389 : 5900;
			}
			if (type !== 'SSH') {
				form.value.authMethod = 'password';
				form.value.sshKeyId = null;
				form.value.route = 'direct';
				form.value.proxyId = null;
				form.value.jumpIds = [];
			}
		},
	);
	onMounted(async () => {
		const current = generation;
		const results = await Promise.allSettled([proxies.load(), sshKeys.load(), connections.load()]);
		if (current === generation && results.some((result) => result.status === 'rejected')) {
			submitError.value = t('connections.failures.options_failed');
		}
	});

	function failure(cause: unknown): void {
		submitError.value = t('connections.failures.' + targetErrorKey(cause));
	}

	async function submit(): Promise<void> {
		if (props.loading || parsing.value || testing.value) {
			return;
		}
		submitError.value = '';
		const current = generation;
		try {
			if (scriptMode.value) {
				parsing.value = true;
				await Promise.all([proxies.load(true), sshKeys.load(true)]);
				if (current !== generation) {
					return;
				}
				emit('submitMany', parseConnectionScript(script.value, proxies.items.value, sshKeys.items.value));
				return;
			}
			const hosts = expandConnectionHosts(form.value.host.trim());
			if (props.connection) {
				if (hosts.length !== 1) {
					throw new InvalidTargetPayload();
				}
				emit('submit', { kind: 'update', changes: toConnectionInput(form.value) });
				return;
			}
			const credential = toConnectionCredential(form.value);
			const items = hosts.map((host) => {
				const draft = toConnectionDraft(null);
				draft.name = form.value.name
					? hosts.length > 1
						? form.value.name + '-' + host.split('.').at(-1)
						: form.value.name
					: host;
				draft.type = form.value.type;
				draft.host = host;
				draft.port = form.value.port;
				draft.username = form.value.username;
				draft.route = form.value.route;
				draft.proxyId = form.value.proxyId;
				draft.tagIds = form.value.tagIds.map((id) => id);
				draft.notes = form.value.notes;
				draft.jumpIds = form.value.jumpIds.map((id) => id);
				return readConnectionImportInput({
					connection: toConnectionInput(draft),
					credential,
				});
			});
			const first = items[0];
			if (!first) {
				throw new InvalidTargetPayload();
			}
			if (items.length === 1) {
				emit('submit', { kind: 'create', input: first });
			} else {
				emit('submitMany', items);
			}
		} catch (cause) {
			if (current === generation) {
				failure(cause);
			}
		} finally {
			if (current === generation) {
				parsing.value = false;
			}
		}
	}

	function saveCredential(): void {
		if (props.loading) {
			return;
		}
		try {
			emit('credential', toConnectionCredential(form.value));
		} catch (cause) {
			failure(cause);
		}
	}

	function clearCredential(): void {
		if (!props.loading) {
			emit('credential', null);
		}
	}

	async function test(): Promise<void> {
		if (testing.value || props.loading) {
			return;
		}
		const current = generation;
		const signal = controller.signal;
		testing.value = true;
		testResult.value = null;
		try {
			let run: () => Promise<number>;
			if (props.connection) {
				const id = props.connection.id;
				run = () => connectionTestApi.saved(id, signal);
			} else {
				const input = toUnsavedTest(form.value);
				run = () => connectionTestApi.unsaved(input, signal);
			}
			const latencyMs = await testConnectionWithHostKeyConfirmation(run, signal);
			if (latencyMs === null) return;
			if (current === generation && !signal.aborted) {
				testResult.value = { success: true, message: t('connections.test.success'), latencyMs };
			}
		} catch (cause) {
			if (current === generation && !signal.aborted) {
				testResult.value = {
					success: false,
					message: t(
						'connections.testFailures.' +
							(cause instanceof ConnectionTestFailure ? cause.code : 'request_failed'),
					),
				};
			}
		} finally {
			if (current === generation) {
				testing.value = false;
			}
		}
	}

	const availableJumpHosts = computed(() =>
		connections.connections.value.filter((item) => item.type === 'SSH' && item.id !== props.connection?.id),
	);

	const jumpHostsForIndex = (index: number) =>
		availableJumpHosts.value.filter((item) => !form.value.jumpIds.some((id, i) => i !== index && id === item.id));

	function addJumpHost(): void {
		if (form.value.jumpIds.length >= TARGET_CONNECTION_MAX_JUMPS) {
			return;
		}
		const next = availableJumpHosts.value.find((item) => !form.value.jumpIds.includes(item.id));
		if (next) {
			form.value.jumpIds.push(next.id);
		}
	}

	function removeJumpHost(index: number): void {
		form.value.jumpIds.splice(index, 1);
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset, { flush: 'sync' });
	onDeactivated(reset);
	onBeforeUnmount(() => {
		generation++;
		controller.abort();
		form.value.password = '';
		script.value = '';
	});
	return {
		form,
		scriptMode,
		script,
		testing,
		parsing,
		testResult,
		submitError,
		proxies,
		ConnectionTagPicker: capabilities.tags.picker,
		SshKeySelector: capabilities.sshKeys.selector,
		availableJumpHosts,
		jumpHostsForIndex,
		addJumpHost,
		removeJumpHost,
		submit,
		test,
		saveCredential,
		clearCredential,
	};
}
