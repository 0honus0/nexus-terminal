import { onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import { registerAuthenticatedSessionReset } from './authenticatedSessionLifecycle';

export type ViewRevocation = 'session' | 'view' | 'disposed';

/** Owns UI intentions; accepted work remains tracked by its feature store or runtime. */
export function useAuthenticatedViewScope(
	options: { available?: () => boolean; onRevoke?: (reason: ViewRevocation) => void } = {},
): {
	capture(): AbortSignal;
	isCurrent(signal: AbortSignal): boolean;
} {
	let scope = new AbortController();
	let active = true;
	let disposed = false;
	const available = options.available ?? (() => true);

	function revoke(reason: ViewRevocation): void {
		scope.abort();
		options.onRevoke?.(reason);
	}

	function activate(): void {
		if (!disposed && active && available() && scope.signal.aborted) {
			scope = new AbortController();
		}
	}

	const unregister = registerAuthenticatedSessionReset('view-' + crypto.randomUUID(), () => revoke('session'));
	watch(
		available,
		(value) => {
			if (value) {
				activate();
			} else {
				revoke('view');
			}
		},
		{ immediate: true, flush: 'sync' },
	);
	onActivated(() => {
		active = true;
		activate();
	});
	onDeactivated(() => {
		active = false;
		revoke('view');
	});
	onBeforeUnmount(() => {
		disposed = true;
		unregister();
		revoke('disposed');
	});

	return {
		capture: (): AbortSignal => scope.signal,

		isCurrent: (signal: AbortSignal): boolean =>
			!disposed && active && available() && scope.signal === signal && !signal.aborted,
	};
}
