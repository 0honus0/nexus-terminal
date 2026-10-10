<script setup lang="ts">
	import { onMounted, onUnmounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { createAccessNextApi } from '@/features/auth/public';
	import { createAgentNextApi } from '../api/agent-next-api';
	import { AgentNextController, type AgentNextControllerState } from '../model/agent-next-controller';

	const { t, te } = useI18n();
	const base = new URL('/__next/', window.location.href);
	const auth = createAccessNextApi(base.toString());
	const agent = createAgentNextApi(base.toString());

	const initialState: AgentNextControllerState = {
		busy: false,
		errorCode: null,
		unknownWrite: null,
		app: null,
		thread: null,
		run: null,
		events: [],
		nextCursor: 0,
	};
	const state = ref<AgentNextControllerState>(initialState);
	const controller = new AgentNextController(agent, (next) => {
		state.value = next;
	});

	const username = ref('');
	const password = ref('');
	const setupNeeded = ref(false);
	const loggedIn = ref(false);
	const authBusy = ref(false);
	const authError = ref('');
	let mounted = true;
	let authGeneration = 0;
	let authRequest: AbortController | null = null;

	const appName = ref('');
	const appId = ref('');
	const threadTitle = ref('');
	const threadId = ref('');
	const prompt = ref('');
	const runId = ref('');
	const expectedVersion = ref(1);

	function localized(code: string | null): string {
		if (!code) return '';
		const key = 'agentNext.errors.' + code;
		return te(key) ? t(key) : t('agentNext.errors.request_failed');
	}

	function beginAuth(): { generation: number; request: AbortController } {
		authGeneration += 1;
		authRequest?.abort();
		const request = new AbortController();
		authRequest = request;
		authBusy.value = true;
		authError.value = '';
		return { generation: authGeneration, request };
	}

	function authActive(generation: number, request: AbortController): boolean {
		return mounted && generation === authGeneration && authRequest === request && !request.signal.aborted;
	}

	async function checkSession(): Promise<void> {
		const current = beginAuth();
		try {
			const needsSetup = await auth.needsSetup(current.request.signal);
			const session = await auth.status(current.request.signal);
			if (!authActive(current.generation, current.request)) return;
			setupNeeded.value = needsSetup;
			loggedIn.value = session !== null;
			controller.reset();
		} catch (error) {
			if (authActive(current.generation, current.request)) {
				authError.value = localized(error instanceof Error ? error.message : 'request_failed');
			}
		} finally {
			if (authActive(current.generation, current.request)) {
				authBusy.value = false;
				authRequest = null;
			}
		}
	}

	async function login(): Promise<void> {
		const current = beginAuth();
		controller.reset();
		try {
			if (setupNeeded.value) {
				await auth.setup(
					{ username: username.value, password: password.value, confirmPassword: password.value },
					current.request.signal,
				);
			}
			await auth.login(
				{ username: username.value, password: password.value, rememberMe: false },
				current.request.signal,
			);
			if (!authActive(current.generation, current.request)) return;
			password.value = '';
			setupNeeded.value = false;
			loggedIn.value = true;
		} catch (error) {
			if (authActive(current.generation, current.request)) {
				authError.value = localized(error instanceof Error ? error.message : 'request_failed');
			}
		} finally {
			if (authActive(current.generation, current.request)) {
				authBusy.value = false;
				authRequest = null;
			}
		}
	}

	async function logout(): Promise<void> {
		const current = beginAuth();
		controller.reset();
		try {
			await auth.logout(current.request.signal);
			if (!authActive(current.generation, current.request)) return;
			loggedIn.value = false;
		} catch (error) {
			if (authActive(current.generation, current.request)) {
				authError.value = localized(error instanceof Error ? error.message : 'request_failed');
			}
		} finally {
			if (authActive(current.generation, current.request)) {
				authBusy.value = false;
				authRequest = null;
			}
		}
	}

	async function createApp(): Promise<void> {
		const created = await controller.createApp(appName.value);
		if (created) appId.value = created.id;
	}

	async function createThread(): Promise<void> {
		const created = await controller.createThread(appId.value, threadTitle.value);
		if (created) threadId.value = created.id;
	}

	async function createRun(): Promise<void> {
		const created = await controller.createRun(appId.value, threadId.value, prompt.value);
		if (created) {
			runId.value = created.id;
			expectedVersion.value = created.version;
		}
	}

	async function getRun(): Promise<void> {
		const current = await controller.getRun(appId.value, runId.value);
		if (current) expectedVersion.value = current.version;
	}

	async function cancelRun(): Promise<void> {
		const current = await controller.cancelRun(appId.value, runId.value, expectedVersion.value);
		if (current) expectedVersion.value = current.version;
	}

	async function listEvents(): Promise<void> {
		await controller.listEvents(appId.value, runId.value);
	}

	watch([appId, threadId, runId], ([nextAppId, nextThreadId, nextRunId]) => {
		const current = state.value.run;
		if (
			current !== null &&
			current.appId === nextAppId &&
			current.threadId === nextThreadId &&
			current.id === nextRunId
		) {
			return;
		}
		controller.resetRunSelection();
	});
	watch(
		() => state.value.run?.version,
		(version) => {
			if (version !== undefined) expectedVersion.value = version;
		},
	);

	onMounted(() => void checkSession());
	onUnmounted(() => {
		mounted = false;
		authGeneration += 1;
		authRequest?.abort();
		authRequest = null;
		controller.dispose();
	});
</script>

<template>
	<main class="mx-auto max-w-4xl space-y-4 p-6">
		<h1 class="text-xl font-semibold">{{ t('agentNext.title') }}</h1>
		<p class="text-sm">{{ t('agentNext.isolation') }}</p>
		<p class="text-xs">/__next/ → NEXUS_VITE_BACKEND_NEXT_ORIGIN</p>

		<p v-if="authError" role="alert">{{ authError }}</p>
		<form v-if="!loggedIn" class="space-y-3 rounded border p-4" @submit.prevent="login">
			<h2 class="font-semibold">{{ setupNeeded ? t('agentNext.setup') : t('agentNext.login') }}</h2>
			<label class="block">
				{{ t('agentNext.username') }}
				<input v-model="username" class="block w-full border p-2" autocomplete="username" required />
			</label>
			<label class="block">
				{{ t('agentNext.password') }}
				<input
					v-model="password"
					class="block w-full border p-2"
					type="password"
					autocomplete="current-password"
					required
				/>
			</label>
			<button class="rounded border px-3 py-2" :disabled="authBusy">{{ t('agentNext.continue') }}</button>
		</form>

		<template v-else>
			<div class="flex items-center gap-3">
				<button class="rounded border px-3 py-2" :disabled="authBusy || state.busy" @click="logout">
					{{ t('agentNext.logout') }}
				</button>
				<span v-if="state.busy">{{ t('agentNext.busy') }}</span>
			</div>
			<p v-if="state.errorCode" role="alert">{{ localized(state.errorCode) }}</p>
			<p v-if="state.unknownWrite" role="status" class="rounded border p-2">
				{{ t('agentNext.unknownWrite') }} {{ state.unknownWrite.kind }} · {{ state.unknownWrite.operationKey }}
			</p>

			<section class="space-y-3 rounded border p-4">
				<h2 class="font-semibold">{{ t('agentNext.scopeTitle') }}</h2>
				<form class="grid gap-2 sm:grid-cols-[1fr_auto]" @submit.prevent="createApp">
					<input v-model="appName" class="border p-2" :placeholder="t('agentNext.appName')" required />
					<button class="rounded border px-3 py-2" :disabled="state.busy">
						{{ t('agentNext.createApp') }}
					</button>
				</form>
				<label class="block">
					{{ t('agentNext.appId') }}
					<input v-model="appId" class="block w-full border p-2" autocomplete="off" />
				</label>
				<form class="grid gap-2 sm:grid-cols-[1fr_auto]" @submit.prevent="createThread">
					<input
						v-model="threadTitle"
						class="border p-2"
						:placeholder="t('agentNext.threadTitle')"
						required
					/>
					<button class="rounded border px-3 py-2" :disabled="state.busy">
						{{ t('agentNext.createThread') }}
					</button>
				</form>
				<label class="block">
					{{ t('agentNext.threadId') }}
					<input v-model="threadId" class="block w-full border p-2" autocomplete="off" />
				</label>
			</section>

			<section class="space-y-3 rounded border p-4">
				<h2 class="font-semibold">{{ t('agentNext.runTitle') }}</h2>
				<label class="block">
					{{ t('agentNext.prompt') }}
					<textarea v-model="prompt" class="block min-h-24 w-full border p-2" required />
				</label>
				<button class="rounded border px-3 py-2" :disabled="state.busy" @click="createRun">
					{{ t('agentNext.createRun') }}
				</button>
				<label class="block">
					{{ t('agentNext.runId') }}
					<input v-model="runId" class="block w-full border p-2" autocomplete="off" />
				</label>
				<label class="block">
					{{ t('agentNext.expectedVersion') }}
					<input
						v-model.number="expectedVersion"
						class="block w-full border p-2"
						type="number"
						min="1"
						step="1"
					/>
				</label>
				<div class="flex flex-wrap gap-2">
					<button class="rounded border px-3 py-2" :disabled="state.busy" @click="getRun">
						{{ t('agentNext.getRun') }}
					</button>
					<button class="rounded border px-3 py-2" :disabled="state.busy" @click="cancelRun">
						{{ t('agentNext.cancelRun') }}
					</button>
					<button class="rounded border px-3 py-2" :disabled="state.busy" @click="listEvents">
						{{ t('agentNext.listEvents') }}
					</button>
				</div>
			</section>

			<section v-if="state.run" class="space-y-2 rounded border p-4">
				<h2 class="font-semibold">{{ t('agentNext.currentRun') }}</h2>
				<pre class="overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify(state.run, null, 2) }}</pre>
			</section>

			<section class="space-y-2 rounded border p-4">
				<h2 class="font-semibold">{{ t('agentNext.events') }}</h2>
				<p>{{ t('agentNext.nextCursor') }}: {{ state.nextCursor }}</p>
				<ul class="space-y-1">
					<li v-for="event in state.events" :key="event.runId + ':' + event.sequence">
						#{{ event.sequence }} · {{ event.type }} · v{{ event.runVersion }}
					</li>
				</ul>
			</section>
		</template>
	</main>
</template>
