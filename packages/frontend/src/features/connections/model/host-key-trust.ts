import { translateUi as t } from '@/shared/i18n/public';
import { useFeedback } from '@/shared/feedback/public';
import { targetErrorKey, TargetRequestFailure } from '@/client/targets/target-types';
import { hostKeysApi } from '../api/host-keys-api';
import type { HostKeyTrustRequest } from './host-key-types';

const MAX_PENDING_CONFIRMATIONS = 64;
let pendingConfirmations = 0;
let confirmationTail: Promise<void> = Promise.resolve();

/** Batch-opened Workspaces share the dialog without replacing one another's confirmation. */
export async function confirmConnectionHostKey(input: HostKeyTrustRequest, signal: AbortSignal): Promise<boolean> {
	if (signal.aborted || pendingConfirmations >= MAX_PENDING_CONFIRMATIONS) {
		return false;
	}
	const request: HostKeyTrustRequest = {
		host: input.host,
		port: input.port,
		fingerprint: input.fingerprint,
		expectedFingerprint: input.expectedFingerprint,
	};
	pendingConfirmations += 1;
	const task = confirmationTail
		.then(() => confirmPresentedHostKey(request, signal))
		.finally(() => {
			pendingConfirmations -= 1;
		});
	confirmationTail = task.then(
		() => undefined,
		() => undefined,
	);

	let cancel: () => void = () => undefined;

	const cancelled = new Promise<boolean>((resolve) => {
		cancel = () => resolve(false);
		signal.addEventListener('abort', cancel, { once: true });
	});
	try {
		return await Promise.race([task, cancelled]);
	} finally {
		signal.removeEventListener('abort', cancel);
	}
}

/** Confirmation is scoped to the live Workspace; cancellation never establishes trust. */
async function confirmPresentedHostKey(input: HostKeyTrustRequest, signal: AbortSignal): Promise<boolean> {
	if (signal.aborted) {
		return false;
	}
	const feedback = useFeedback();
	const changed = input.expectedFingerprint !== null;
	const accepted = await feedback.confirm({
		signal,
		title: t('hostKeys.title'),
		message: t(changed ? 'hostKeys.changedConnection' : 'hostKeys.firstConnection', {
			host: input.host,
			port: input.port,
			fingerprint: input.fingerprint,
			expectedFingerprint: input.expectedFingerprint ?? '',
		}),
		details: [
			{ label: t('hostKeys.endpoint'), value: `${input.host}:${input.port}` },
			...(input.expectedFingerprint === null
				? []
				: [
						{
							label: t('hostKeys.savedFingerprint'),
							value: input.expectedFingerprint,
							mono: true,
						} as const,
					]),
			{
				label: t('hostKeys.fingerprint'),
				value: input.fingerprint,
				mono: true,
				tone: changed ? 'danger' : 'primary',
			},
		],
		confirmText: t('hostKeys.confirmAndConnect'),
		destructive: changed,
		tone: changed ? 'danger' : 'primary',
		icon: changed ? 'fas fa-shield-halved' : 'fas fa-fingerprint',
	});
	if (!accepted || signal.aborted) {
		return false;
	}
	try {
		await hostKeysApi.confirm({ host: input.host, port: input.port, fingerprint: input.fingerprint }, signal);
		return !signal.aborted;
	} catch (cause) {
		if (signal.aborted) {
			return false;
		}
		// A lost receipt is reconciled by reading, never by repeating the trust write.
		if (cause instanceof TargetRequestFailure && cause.outcome === 'unknown') {
			try {
				const keys = await hostKeysApi.list(signal);
				if (signal.aborted) {
					return false;
				}
				if (
					keys.some(
						(key) =>
							key.host === input.host && key.port === input.port && key.fingerprint === input.fingerprint,
					)
				) {
					return true;
				}
			} catch {
				if (signal.aborted) {
					return false;
				}
			}
		}
		feedback.notifyError(t('hostKeys.failures.' + targetErrorKey(cause, 'write')));
		return false;
	}
}
