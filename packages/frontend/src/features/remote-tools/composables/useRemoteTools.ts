import { ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeedback } from '@/shared/feedback/public';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import { remoteToolApi } from '../api/tool-api';
import {
	ToolInstallFailure,
	type ToolRequirement,
	type ToolOffer,
	type ToolPreparation,
	type TransferToolRequirement,
} from '../model/tool-types';

export function useRemoteTools() {
	const { t } = useI18n();
	const feedback = useFeedback();
	const offer = shallowRef<ToolOffer | null>(null);
	const busy = ref(false);
	const allowFallback = ref(false);
	let pending = false;
	let transferPending = false;
	let decide: ((value: string | undefined | null) => void) | null = null;
	const scope = useAuthenticatedViewScope();

	function approve(password?: string): void {
		decide?.(password);
	}

	function cancel(): void {
		if (!busy.value) {
			decide?.(null);
		}
	}

	async function prepare(input: ToolRequirement, external: AbortSignal): Promise<ToolPreparation> {
		if (pending) {
			return 'cancelled';
		}
		const permission = scope.capture();
		const signal = AbortSignal.any([permission, external]);
		if (signal.aborted) {
			return 'cancelled';
		}
		pending = true;
		allowFallback.value = input.kind === 'transfer';
		try {
			let checked: ToolOffer;
			try {
				checked = await remoteToolApi.check(input, signal);
			} catch (cause) {
				// Only a confirmed network rejection during the read-only check
				// can be deferred to the transfer task's per-target result.
				if (
					!signal.aborted &&
					input.kind === 'transfer' &&
					cause instanceof ToolInstallFailure &&
					cause.code === 'connection_unavailable'
				) {
					return 'deferred';
				}
				throw cause;
			}
			if (signal.aborted) {
				return 'cancelled';
			}
			if (!checked.missing.length) {
				return 'ready';
			}
			if (!checked.planId && input.kind !== 'transfer') {
				throw new ToolInstallFailure('unsupported');
			}
			offer.value = checked;
			const password = await new Promise<string | undefined | null>((resolve) => {
				const abort = () => finish(null);

				const finish = (value: string | undefined | null) => {
					signal.removeEventListener('abort', abort);
					decide = null;
					resolve(value);
				};

				decide = finish;
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) {
					abort();
				}
			});
			if (signal.aborted) {
				return 'cancelled';
			}
			if (password === null) {
				return input.kind === 'transfer' ? 'declined' : 'cancelled';
			}
			if (!checked.planId) {
				throw new ToolInstallFailure('unsupported');
			}
			busy.value = true;
			await remoteToolApi.install(checked, password, signal);
			return signal.aborted ? 'cancelled' : 'ready';
		} catch (cause) {
			if (!signal.aborted) {
				feedback.notifyError(
					t('remoteTools.errors.' + (cause instanceof ToolInstallFailure ? cause.code : 'unavailable')),
				);
			}
			return 'cancelled';
		} finally {
			offer.value = null;
			busy.value = false;
			allowFallback.value = false;
			pending = false;
			decide = null;
		}
	}

	async function prepareTransfer(input: TransferToolRequirement, signal: AbortSignal): Promise<boolean> {
		if (transferPending || signal.aborted) {
			return false;
		}
		transferPending = true;
		try {
			for (const targetId of input.targetIds) {
				const methods: Array<'rsync' | 'scp'> = input.method === 'auto' ? ['rsync'] : [input.method];
				if (input.method === 'auto' && !input.directories) {
					methods.push('scp');
				}
				for (const method of methods) {
					let declined = false;
					for (const side of ['source', 'target'] as const) {
						const result = await prepare(
							{
								kind: 'transfer',
								targetId: side === 'source' ? input.sourceId : targetId,
								peerId: side === 'source' ? targetId : input.sourceId,
								side,
								method,
							},
							signal,
						);
						if (result === 'cancelled' || signal.aborted) {
							return false;
						}
						if (result === 'declined' || result === 'deferred') {
							declined = result === 'declined';
							break;
						}
					}
					if (!declined) {
						break;
					}
				}
			}
			return !signal.aborted;
		} finally {
			transferPending = false;
		}
	}

	return { offer, busy, allowFallback, prepare, prepareTransfer, approve, cancel };
}
