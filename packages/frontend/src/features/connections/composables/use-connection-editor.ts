import { onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthSession } from '@/features/auth/public';
import { useFeedback, useFeedbackMessage } from '@/shared/feedback/public';
import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
import { TargetRequestFailure, targetErrorKey } from '@/client/targets/target-types';
import { readConnectionImportRequest } from '@nexus-terminal/shared/targets/connections/http-codec';
import { TARGET_CONNECTION_IMPORT_MAX_ITEMS } from '@nexus-terminal/shared/targets/connections/values';
import type {
	TargetImportInput,
	TargetCredentialInput,
	TargetImportItem,
} from '@nexus-terminal/shared/targets/connections/http';
import { connectionsApi } from '../api/connections-api';
import type {
	ConnectionSummary,
	ConnectionSubmission,
	CredentialSummary,
	ConnectionImportReceipt,
} from '../model/connection-types';
import { useConnections } from './useConnections';

export function useConnectionEditor(
	props: Readonly<{ visible: boolean; connection?: ConnectionSummary | null }>,
	emit: {
		(event: 'close'): void;
		(event: 'saved', value: ConnectionSummary): void;
		(event: 'deleted', id: number): void;
	},
) {
	const { t } = useI18n();
	const auth = useAuthSession();
	const feedback = useFeedback();
	const capabilities = useRuntimeFeatureCapabilities();
	const data = useConnections();
	const snapshot = ref<ConnectionSummary | null>(null);
	const credential = ref<CredentialSummary | null>(null);
	const loading = ref(false);
	const ready = ref(false);
	const message = ref('');
	let failureCause: unknown;
	const messageSuccess = ref(false);
	useFeedbackMessage(
		() => message.value,
		() => (messageSuccess.value ? 'success' : 'error'),
		() => failureCause,
	);
	const receipts = ref<ConnectionImportReceipt[]>([]);
	let generation = 0;
	let controller: AbortController | null = null;
	let disposed = false;

	function reset(): void {
		generation++;
		controller?.abort();
		controller = null;
		loading.value = false;
		ready.value = false;
		snapshot.value = null;
		credential.value = null;
		message.value = '';
		failureCause = undefined;
		messageSuccess.value = false;
		receipts.value = [];
	}

	async function execute(
		work: (signal: AbortSignal) => Promise<void>,
		operation: 'read' | 'write' = 'write',
	): Promise<void> {
		if (disposed || !props.visible || loading.value) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		message.value = '';
		failureCause = undefined;
		messageSuccess.value = false;
		try {
			await work(signal);
		} catch (cause) {
			if (current === generation && !signal.aborted) {
				failureCause = cause;
				message.value = t('connections.failures.' + targetErrorKey(cause, operation));
			}
		} finally {
			if (current === generation) {
				loading.value = false;
				controller = null;
			}
		}
	}

	function refresh(): Promise<void> {
		return execute(async (signal) => {
			ready.value = false;
			receipts.value = [];
			snapshot.value = null;
			credential.value = null;
			await data.load(true);
			if (signal.aborted) {
				return;
			}
			if (props.connection) {
				const id = props.connection.id;
				const [item, state] = await Promise.all([
					connectionsApi.get(id, signal),
					connectionsApi.credential(id, signal),
				]);
				if (signal.aborted) {
					return;
				}
				if (item.version !== state.version) {
					throw new TargetRequestFailure('version_conflict', 'confirmed');
				}
				snapshot.value = item;
				credential.value = state;
			}
			ready.value = true;
		}, 'read');
	}

	async function finish(signal: AbortSignal, id?: number): Promise<void> {
		if (signal.aborted) {
			return;
		}
		messageSuccess.value = true;
		message.value = t('connections.saved');
		try {
			const items = await data.load(true);
			if (signal.aborted) {
				return;
			}
			const item = items.find((item) => item.id === id);
			if (item) {
				emit('saved', item);
			}
		} catch {
			if (!signal.aborted) {
				feedback.notifyWarning(t('connections.savedRefreshFailed'));
			}
		}
		if (!signal.aborted) {
			emit('close');
		}
	}

	async function importItems(inputs: TargetImportInput[], signal: AbortSignal): Promise<TargetImportItem[]> {
		try {
			return await data.importMany(inputs, signal);
		} finally {
			// An import may have created related resources even when its acknowledgement was lost.
			// Refresh their existing owners without clearing the connection write-recovery fence.
			const results = await Promise.allSettled([
				capabilities.tags.load(true),
				capabilities.proxies.load(true),
				capabilities.sshKeys.load(true),
			]);
			if (!signal.aborted && results.some((result) => result.status === 'rejected')) {
				feedback.notifyWarning(t('connections.failures.options_failed'));
			}
		}
	}

	function save(value: ConnectionSubmission): Promise<void> {
		return execute(async (signal) => {
			if (value.kind === 'update') {
				const original = snapshot.value;
				if (!original) {
					throw new TargetRequestFailure('invalid_input', 'not_dispatched');
				}
				await data.update(original, value.changes, signal);
				await finish(signal, original.id);
			} else {
				const result = await importItems([value.input], signal);
				if (signal.aborted) {
					return;
				}
				const first = result[0];
				if (!first || first.status !== 'ok') {
					message.value = t('connections.failures.' + (first?.status === 'error' ? first.code : 'failed'));
					return;
				}
				await finish(signal, first.id);
			}
		});
	}

	function saveMany(inputs: TargetImportInput[]): Promise<void> {
		return execute(async (signal) => {
			receipts.value = [];
			if (!inputs.length) {
				throw new TargetRequestFailure('invalid_input', 'not_dispatched');
			}
			const chunks: TargetImportInput[][] = [];
			for (let offset = 0; offset < inputs.length; offset += TARGET_CONNECTION_IMPORT_MAX_ITEMS) {
				chunks.push(
					readConnectionImportRequest({
						items: inputs.slice(offset, offset + TARGET_CONNECTION_IMPORT_MAX_ITEMS),
					}).items,
				);
			}
			let completed = 0;
			let refused = 0;
			let lastId: number | undefined;
			for (const chunk of chunks) {
				let results: TargetImportItem[];
				try {
					results = await importItems(chunk, signal);
				} catch (cause) {
					if (!signal.aborted) {
						message.value =
							t('connections.partialCreation', { count: completed }) +
							' ' +
							t('connections.failures.' + targetErrorKey(cause));
					}
					return;
				}
				if (signal.aborted) {
					return;
				}
				for (const result of results) {
					const index = receipts.value.length + 1;
					if (result.status === 'ok') {
						receipts.value.push({ index, status: 'ok', id: result.id });
						completed++;
						lastId = result.id;
					} else {
						receipts.value.push({ index, status: 'error', code: result.code });
						refused++;
					}
				}
				if (signal.aborted) {
					return;
				}
				if (refused) {
					break;
				}
				// Each chunk is independent. Re-read actual commits before admitting the next one.
				try {
					await data.load(true);
				} catch {
					if (!signal.aborted) {
						message.value =
							t('connections.partialCreation', { count: completed }) +
							' ' +
							t('connections.savedRefreshFailed');
					}
					return;
				}
			}
			if (refused) {
				message.value =
					t('connections.partialCreation', { count: completed }) +
					' ' +
					t('connections.importRefused', { count: refused });
				return;
			}
			await finish(signal, lastId);
		});
	}

	function saveCredential(value: TargetCredentialInput | null): Promise<void> {
		return execute(async (signal) => {
			const original = snapshot.value;
			if (!original || !credential.value || credential.value.version !== original.version) {
				throw new TargetRequestFailure('version_conflict', 'confirmed');
			}
			if (
				value === null &&
				!(await feedback.confirm({
					signal,
					message: t('connections.clearCredentialPrompt'),
					destructive: true,
				}))
			) {
				return;
			}
			if (signal.aborted) {
				return;
			}
			await data.setCredential(original, value, signal);
			await finish(signal, original.id);
		});
	}

	function remove(): Promise<void> {
		return execute(async (signal) => {
			const original = snapshot.value;
			if (!original) {
				return;
			}
			const accepted = await feedback.confirm({
				signal,
				message: t('connections.prompts.confirmDelete', { name: original.name }),
				destructive: true,
			});
			if (!accepted || signal.aborted) {
				return;
			}
			await data.remove(original.id, signal);
			if (!signal.aborted) {
				emit('deleted', original.id);
				emit('close');
			}
		});
	}

	watch(
		() => [props.visible, props.connection?.id],
		() => {
			reset();
			if (props.visible) {
				void refresh();
			}
		},
		{ immediate: true, flush: 'sync' },
	);
	watch(
		() => (auth.isAuthenticated.value ? auth.user.value?.id : null),
		() => {
			reset();
			emit('close');
		},
		{ flush: 'sync' },
	);
	onDeactivated(() => {
		reset();
		emit('close');
	});
	onBeforeUnmount(() => {
		disposed = true;
		reset();
	});
	return {
		snapshot,
		credential,
		loading,
		ready,
		message,
		receipts,
		data,
		refresh,
		save,
		saveMany,
		saveCredential,
		remove,
	};
}
