import { computed, ref, shallowReadonly, shallowRef } from 'vue';
import { HttpProblemSchema } from '../../http/http-problem-http-types.js';
import type { LogApi } from '../../log/browser/log-api.js';
import { CodedError } from '../../utils/error.js';
import {
	AuthCredentialsSchema,
	AuthStateSchema,
	authInitializePath,
	authLoginPath,
	authLogoutPath,
	authPasswordPath,
	authStatePath,
	type AuthCredentials,
	type AuthChangePassword,
	type AuthState,
} from '../auth-http-types.js';

export { default as AuthPage } from './AuthPage.vue';

export { authMessages } from './auth-messages.js';

/** 认证事实来自服务端状态。旧查询不能覆盖一次已确认的会话变更。 */
export class AuthApi {
	readonly #state = shallowRef<AuthState>();
	readonly state = shallowReadonly(this.#state);
	readonly #reads = ref(0);
	readonly checking = computed(() => this.#reads.value > 0);
	readonly #signal: AbortSignal;
	readonly #log: Pick<LogApi, 'report'>;
	#revision = 0;
	#published = 0;
	#passwordChange: Promise<void> | undefined;

	constructor(signal: AbortSignal, log: Pick<LogApi, 'report'>) {
		this.#signal = signal;
		this.#log = log;
	}

	async refresh(signal: AbortSignal = this.#signal): Promise<void> {
		const lifetime = AbortSignal.any([signal, this.#signal]);
		lifetime.throwIfAborted();
		const revision = ++this.#revision;
		this.#reads.value++;
		try {
			const response = await this.#request(authStatePath, { signal: lifetime });
			const state = AuthStateSchema.parse(await response.json());
			lifetime.throwIfAborted();
			if (revision <= this.#published) return;
			this.#published = revision;
			this.#state.value = state;
		} finally {
			this.#reads.value--;
		}
	}

	async signIn(credentials: AuthCredentials, signal: AbortSignal): Promise<void> {
		const state = this.#state.value;
		if (!state) throw new CodedError('AUTH_STATE_READ_FAILED');
		const { success, data } = AuthCredentialsSchema.safeParse(credentials);
		if (!success) throw new CodedError('AUTH_CREDENTIALS_REQUIRED');
		await this.#change(state.initialized ? authLoginPath : authInitializePath, data, signal);
	}

	logout(): Promise<void> {
		return this.#change(authLogoutPath, {}, this.#signal);
	}

	changePassword(input: AuthChangePassword): Promise<void> {
		return (this.#passwordChange ??= this.#change(authPasswordPath, input, this.#signal).finally(() => {
			this.#passwordChange = undefined;
		}));
	}

	async reconcileSession(signal: AbortSignal): Promise<void> {
		await this.#passwordChange?.catch(() => undefined);
		await this.refresh(signal);
	}

	/** 来自宿主状态连接的会话撤销通知。 */
	expire(): void {
		const state = this.#state.value;
		if (!state?.account) return;
		this.#published = ++this.#revision;
		this.#state.value = { ...state, account: null };
	}

	reportFailure(cause: unknown): void {
		if (this.#signal.aborted) return;
		const code = cause instanceof CodedError ? cause.code : 'AUTH_REQUEST_FAILED';
		this.#log.report({ source: 'auth', level: 'error', code, userVisible: true });
	}

	async #change(path: string, input: object, signal: AbortSignal): Promise<void> {
		const lifetime = AbortSignal.any([signal, this.#signal]);
		lifetime.throwIfAborted();
		try {
			const response = await this.#request(path, {
				method: 'POST',
				signal: lifetime,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input),
			});
			await response.body?.cancel();
		} catch (cause) {
			// 网络中断时会话可能已写入，核对状态仍由宿主完成。
			if (lifetime.aborted) throw cause;
			if (cause instanceof CodedError && cause.code !== 'AUTH_ALREADY_INITIALIZED') throw cause;
			await this.refresh(lifetime).catch(() => undefined);
			throw cause;
		}
		lifetime.throwIfAborted();
		this.#published = ++this.#revision;
		await this.refresh(lifetime);
	}

	async #request(path: string, options: RequestInit): Promise<Response> {
		const response = await fetch(`/api${path}`, options);
		if (response.ok) return response;
		const problem = HttpProblemSchema.safeParse(await response.json().catch(() => undefined));
		throw new CodedError(problem.success ? problem.data.code : 'AUTH_REQUEST_FAILED');
	}
}
