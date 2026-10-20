import { onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthSession } from '@/features/auth/public';
import { useFeedback } from '@/shared/feedback/public';
import { TargetRequestFailure, targetErrorKey } from '@/client/targets/target-types';
import { InvalidTargetPayload } from '@nexus-terminal/shared/targets/http';
import {
	readConnectionChanges,
	readCredentialInput,
	readConnectionImportInput,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import { TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import type { ConnectionSummary, ConnectionBatchCommand, ConnectionTestSummary } from '../model/connection-types';
import { connectionTestApi } from '../api/connection-test-api';
import { ConnectionTestFailure } from '../model/connection-errors';
import { useConnections } from './useConnections';
import { CONNECTION_CREATION_MAX_ITEMS } from '../model/connection-script';

export function useConnectionManagement() {
	const { t } = useI18n();
	const auth = useAuthSession();
	const feedback = useFeedback();
	const data = useConnections();
	const selected = ref(new Set<number>());
	const batchModal = ref(false);
	const loading = ref(false);
	const message = ref('');
	const testing = ref(new Set<number>());
	const testResults = ref(new Map<number, ConnectionTestSummary>());
	const batchSnapshots = ref<ConnectionSummary[]>([]);
	let generation = 0;
	let controller = new AbortController();

	function reset(): void {
		generation++;
		controller.abort();
		controller = new AbortController();
		loading.value = false;
		batchModal.value = false;
		batchSnapshots.value = [];
		selected.value = new Set();
		testing.value = new Set();
		testResults.value = new Map();
		message.value = '';
	}

	async function execute(
		work: (signal: AbortSignal) => Promise<void>,
		operation: 'read' | 'write' = 'write',
	): Promise<void> {
		if (loading.value) {
			return;
		}
		const current = generation;
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		try {
			await work(signal);
		} catch (cause) {
			if (current === generation && !signal.aborted) {
				message.value = t('connections.failures.' + targetErrorKey(cause, operation));
			}
		} finally {
			if (current === generation) {
				loading.value = false;
			}
		}
	}

	function refresh(): Promise<void> {
		batchModal.value = false;
		return execute(async (signal) => {
			await data.load(true);
			if (!signal.aborted) {
				selected.value = new Set();
			}
		}, 'read');
	}

	function openBatch(): void {
		if (data.busy.value || data.needsRefresh.value || loading.value) {
			return;
		}
		batchSnapshots.value = data.connections.value.filter((item) => selected.value.has(item.id));
		batchModal.value = batchSnapshots.value.length > 0;
	}

	function clone(item: ConnectionSummary): Promise<void> {
		return execute(async (signal) => {
			await data.clone(item.id, t('connections.cloneName', { name: item.name }), signal);
		});
	}

	async function test(item: ConnectionSummary): Promise<void> {
		if (testing.value.has(item.id) || item.type !== 'SSH') {
			return;
		}
		const current = generation;
		const signal = controller.signal;
		testing.value.add(item.id);
		try {
			const latencyMs = await connectionTestApi.saved(item.id, signal);
			if (current === generation && !signal.aborted) {
				testResults.value.set(item.id, { success: true, message: t('connections.test.success'), latencyMs });
			}
		} catch (cause) {
			if (current === generation && !signal.aborted) {
				testResults.value.set(item.id, {
					success: false,
					message: t(
						'connections.testFailures.' +
							(cause instanceof ConnectionTestFailure ? cause.code : 'request_failed'),
					),
				});
			}
		} finally {
			if (current === generation) {
				testing.value.delete(item.id);
			}
		}
	}

	async function testAll(items: readonly ConnectionSummary[]): Promise<void> {
		const current = generation;
		for (const item of items) {
			if (current !== generation) {
				return;
			}
			await test(item);
		}
	}

	async function apply(
		items: readonly ConnectionSummary[],
		work: (item: ConnectionSummary, signal: AbortSignal) => Promise<unknown>,
		signal: AbortSignal,
	): Promise<void> {
		let completed = 0;
		for (const item of items) {
			if (signal.aborted) {
				return;
			}
			try {
				await work(item, signal);
			} catch (cause) {
				if (!signal.aborted) {
					message.value =
						t('connections.partialMutation', { count: completed }) +
						' ' +
						t('connections.failures.' + targetErrorKey(cause));
				}
				return;
			}
			if (signal.aborted) {
				return;
			}
			completed++;
			selected.value.delete(item.id);
			if (data.needsRefresh.value) {
				try {
					await data.load(true);
				} catch {
					if (!signal.aborted) {
						message.value =
							t('connections.partialMutation', { count: completed }) +
							' ' +
							t('connections.savedRefreshFailed');
					}
					return;
				}
			}
		}
		message.value = t('connections.completed', { count: completed });
		batchModal.value = false;
	}

	function removeMany(items: readonly ConnectionSummary[]): Promise<void> {
		return execute(async (signal) => {
			if (
				!items.length ||
				!(await feedback.confirm({
					signal,
					message: t('connections.batchEdit.confirmMessage', { count: items.length }),
					destructive: true,
				}))
			) {
				return;
			}
			await apply(items, (item, scope) => data.remove(item.id, scope), signal);
		});
	}

	function deleteSelected(): Promise<void> {
		return removeMany(data.connections.value.filter((item) => selected.value.has(item.id)));
	}

	function remove(item: ConnectionSummary): Promise<void> {
		return removeMany([item]);
	}

	function batchSave(command: ConnectionBatchCommand): Promise<void> {
		const items = batchSnapshots.value.map((item) => item);
		return execute(async (signal) => {
			if (!items.length) {
				throw new InvalidTargetPayload();
			}
			if (command.kind === 'metadata') {
				const changes = readConnectionChanges(command.changes);
				if (
					items.some(
						(item) =>
							item.type !== 'SSH' &&
							((changes.route !== undefined && changes.route !== 'direct') || changes.proxyId != null),
					)
				) {
					throw new InvalidTargetPayload();
				}
				await apply(items, (item, scope) => data.update(item, changes, scope), signal);
			} else {
				const credential = command.credential === null ? null : readCredentialInput(command.credential);
				if (credential?.kind === 'ssh_key' && items.some((item) => item.type !== 'SSH')) {
					throw new InvalidTargetPayload();
				}
				if (
					!(await feedback.confirm({
						signal,
						message: t('connections.batchCredentialPrompt', { count: items.length }),
						destructive: true,
					}))
				) {
					return;
				}
				// Known credential success invalidates metadata versions. Each following item still uses its original snapshot.
				await apply(
					items,
					async (item, scope) => {
						await data.setCredential(item, credential, scope);
					},
					signal,
				);
			}
		});
	}

	function exportItems(items: readonly ConnectionSummary[]): void {
		try {
			if (data.needsRefresh.value || !items.length) {
				throw new TargetRequestFailure('recovery_required', 'not_dispatched');
			}
			if (items.length > CONNECTION_CREATION_MAX_ITEMS) {
				throw new TargetRequestFailure('limit_exceeded', 'not_dispatched');
			}
			const output = items.map((item) =>
				readConnectionImportInput({
					connection: {
						name: item.name,
						type: item.type,
						host: item.host,
						port: item.port,
						username: item.username,
						route: item.route,
						proxyId: item.proxyId,
						notes: item.notes,
						rdpRemoteApp: item.rdpRemoteApp,
						rdpRemoteAppDirectory: item.rdpRemoteAppDirectory,
						rdpRemoteAppArguments: item.rdpRemoteAppArguments,
						tagIds: item.tagIds.map((id) => id),
						jumpIds: item.jumpIds.map((id) => id),
					},
				}),
			);
			const encoded = JSON.stringify(output, null, 2);
			if (new TextEncoder().encode(encoded).byteLength > TARGET_CONNECTION_IMPORT_FILE_MAX_BYTES) {
				throw new TargetRequestFailure('limit_exceeded', 'not_dispatched');
			}
			const url = URL.createObjectURL(new Blob([encoded], { type: 'application/json' }));
			try {
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = 'connections.json';
				anchor.click();
			} finally {
				URL.revokeObjectURL(url);
			}
		} catch (cause) {
			message.value = t('connections.failures.' + targetErrorKey(cause));
		}
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), reset, { flush: 'sync' });
	onDeactivated(reset);
	onBeforeUnmount(reset);
	return {
		data,
		selected,
		batchModal,
		loading,
		message,
		testing,
		testResults,
		refresh,
		openBatch,
		clone,
		test,
		testAll,
		deleteSelected,
		remove,
		removeMany,
		batchSave,
		cancelBatch: reset,
		exportItems,
	};
}
