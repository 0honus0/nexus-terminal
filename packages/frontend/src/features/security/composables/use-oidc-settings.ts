import { onMounted, onBeforeUnmount, onDeactivated, onActivated, ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
	createOidcApi,
	redirectToOidc,
	AuthRequestFailure,
	authErrorKey,
	useAuthSession,
	type OidcSettings,
} from '@/features/auth/public';
import { useFeedbackMessage } from '@/shared/feedback/public';

export function useOidcSettings() {
	const api = createOidcApi();
	const auth = useAuthSession();
	const router = useRouter();
	const { t } = useI18n();
	const settings = ref<OidcSettings | null>(null);
	const original = ref('');
	const secret = ref('');
	const password = ref('');
	const busy = ref(false);
	const needsRefresh = ref(false);
	const message = ref('');
	const success = ref(false);
	let cause: unknown;
	let active = true;
	let generation = 0;
	let controller: AbortController | null = null;
	useFeedbackMessage(
		() => message.value,
		() => (success.value ? 'success' : 'error'),
		() => cause,
	);
	const dirty = computed(
		() => settings.value !== null && (JSON.stringify(settings.value) !== original.value || secret.value !== ''),
	);

	function invalidate(): void {
		active = false;
		generation += 1;
		controller?.abort();
		controller = null;
		if (busy.value) {
			needsRefresh.value = true;
		}
		busy.value = false;
		password.value = '';
		secret.value = '';
	}

	async function run(work: (signal: AbortSignal) => Promise<void>, reading = false): Promise<void> {
		if (!active || busy.value || (!reading && needsRefresh.value)) {
			return;
		}
		const current = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		busy.value = true;
		message.value = '';
		success.value = false;
		try {
			await work(signal);
		} catch (error) {
			if (current !== generation || !active) {
				return;
			}
			cause = error;
			message.value = t(authErrorKey(error));
			if (
				reading ||
				!(error instanceof AuthRequestFailure) ||
				error.outcome === 'unknown' ||
				error.code === 'conflict'
			) {
				needsRefresh.value = true;
			}
		} finally {
			if (current === generation && active) {
				busy.value = false;
				controller = null;
				password.value = '';
			}
		}
	}

	async function read(signal: AbortSignal): Promise<void> {
		const result = await api.settings(signal);
		if (signal.aborted || !active) {
			return;
		}
		settings.value = result;
		original.value = JSON.stringify(result);
		secret.value = '';
		needsRefresh.value = false;
	}

	async function afterChange(signal: AbortSignal): Promise<void> {
		if (signal.aborted || !active) {
			return;
		}
		const state = await auth.refreshSession();
		// Configuration changes intentionally revoke a session created by this provider.
		if (state === 'anonymous') {
			await router.replace({ name: 'Login' });
			return;
		}
		if (!signal.aborted && active) {
			await read(signal);
		}
	}

	function refresh(): Promise<void> {
		return run(read, true);
	}

	function save(): Promise<void> {
		return run(async (signal) => {
			const c = settings.value;
			if (!c) {
				return;
			}
			await api.save(
				{
					revision: c.revision,
					enabled: c.enabled,
					label: c.label,
					issuer: c.issuer,
					clientId: c.clientId,
					clientAuthentication: c.clientAuthentication,
					secret:
						c.clientAuthentication === 'none'
							? { action: 'clear' }
							: secret.value
								? { action: 'replace', value: secret.value }
								: { action: 'keep' },
					password: password.value,
				},
				signal,
			);
			if (signal.aborted || !active) {
				return;
			}
			await afterChange(signal);
			if (signal.aborted || !active) {
				return;
			}
			success.value = true;
			message.value = t('settings.oidc.saved');
		});
	}

	function bind(): Promise<void> {
		return run(async (signal) => {
			const revision = settings.value?.revision;
			if (!revision || dirty.value) {
				return;
			}
			const url = await api.bind(revision, password.value, signal);
			if (!signal.aborted && active) {
				redirectToOidc(url, 'binding');
			}
		});
	}

	function unbind(): Promise<void> {
		return run(async (signal) => {
			const revision = settings.value?.revision;
			if (!revision || dirty.value) {
				return;
			}
			await api.unbind(revision, password.value, signal);
			if (!signal.aborted && active) {
				await afterChange(signal);
			}
		});
	}

	onMounted(refresh);
	onBeforeUnmount(invalidate);
	onDeactivated(invalidate);
	onActivated(() => {
		if (!active) {
			active = true;
			void refresh();
		}
	});
	watch(auth.isAuthenticated, (authenticated) => {
		if (!authenticated) {
			invalidate();
			settings.value = null;
		}
	});
	return { settings, secret, password, busy, needsRefresh, dirty, refresh, save, bind, unbind };
}
