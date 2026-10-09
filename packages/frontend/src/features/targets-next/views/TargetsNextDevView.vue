<script setup lang="ts">
	import { defineAsyncComponent, onMounted, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { loadRemoteNextTerminal } from '@/runtimes/remote-next/public';
	import { createTargetsNextApi } from '../api/targets-next-api';
	import type {
		TargetConnectionInput,
		TargetConnectionView,
		TargetImportInput,
	} from '@nexus-terminal/shared/connections/model';
	import type { TargetProxyView } from '@nexus-terminal/shared/proxies/model';
	import type { TargetTagView } from '@nexus-terminal/shared/tags/model';
	import type { TargetSshKeyView } from '@nexus-terminal/shared/ssh-keys/model';
	import type { TargetHostKeyView } from '@nexus-terminal/shared/targets/host-keys';

	const RemoteNextTerminal = defineAsyncComponent(loadRemoteNextTerminal);
	const { t } = useI18n();
	const base = new URL('/__next/', window.location.href);
	const api = createTargetsNextApi(base.toString());
	const username = ref('');
	const password = ref('');
	const loggedIn = ref(false);
	const setupNeeded = ref(false);
	const busy = ref(false);
	const error = ref('');
	const message = ref('');
	const active = ref<'connections' | 'proxies' | 'tags' | 'keys'>('connections');
	const connections = ref<TargetConnectionView[]>([]);
	const proxies = ref<TargetProxyView[]>([]);
	const tags = ref<TargetTagView[]>([]);
	const keys = ref<TargetSshKeyView[]>([]);
	const trustedHosts = ref<TargetHostKeyView[]>([]);
	const hostKeyHost = ref('');
	const hostKeyPort = ref(22);
	const hostKeyFingerprint = ref('');
	const verifiedOutOfBand = ref(false);
	const selectedRemoteId = ref<number | null>(null);
	const name = ref('');
	const host = ref('');
	const port = ref(22);
	const user = ref('');
	const passwordField = ref('');
	const secretKey = ref('');
	const tagNames = ref('');

	async function access(path: string, body?: unknown): Promise<unknown> {
		const response = await fetch('/__next/api/v1/auth/' + path, {
			method: body === undefined ? 'GET' : 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const value: unknown = await response.json();
		if (!response.ok)
			throw new Error(
				typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
					? value.code
					: 'request_failed',
			);
		return value;
	}

	async function run(job: () => Promise<void>): Promise<void> {
		busy.value = true;
		error.value = '';
		message.value = '';
		try {
			await job();
		} catch (cause) {
			error.value = cause instanceof Error ? cause.message : 'request_failed';
		} finally {
			busy.value = false;
		}
	}

	async function refresh(): Promise<void> {
		const [c, p, t, k, h] = await Promise.all([
			api.connections.list(),
			api.proxies.list(),
			api.tags.list(),
			api.sshKeys.list(),
			api.hostKeys.list(),
		]);
		connections.value = c;
		proxies.value = p;
		tags.value = t;
		keys.value = k;
		trustedHosts.value = h;
	}

	async function checkSession(): Promise<void> {
		await run(async () => {
			const result = await access('needs-setup');
			if (result && typeof result === 'object' && 'needsSetup' in result) {
				setupNeeded.value = result.needsSetup === true;
			}
			const status = await fetch('/__next/api/v1/auth/status', { credentials: 'same-origin', cache: 'no-store' });
			loggedIn.value = status.ok;
			if (loggedIn.value) await refresh();
		});
	}

	function login(): void {
		void run(async () => {
			if (setupNeeded.value)
				await access('setup', {
					username: username.value,
					password: password.value,
					confirmPassword: password.value,
				});
			await access('login', { username: username.value, password: password.value, rememberMe: false });
			password.value = '';
			loggedIn.value = true;
			setupNeeded.value = false;
			await refresh();
		});
	}

	function logout(): void {
		void run(async () => {
			await access('logout', {});
			loggedIn.value = false;
			connections.value = [];
			proxies.value = [];
			tags.value = [];
			keys.value = [];
			trustedHosts.value = [];
			selectedRemoteId.value = null;
		});
	}

	function newConnection(): TargetConnectionInput {
		return {
			name: name.value,
			type: 'SSH',
			host: host.value,
			port: port.value,
			username: user.value,
			route: 'direct',
			proxyId: null,
			notes: null,
			rdpRemoteApp: null,
			rdpRemoteAppDirectory: null,
			rdpRemoteAppArguments: null,
			tagIds: [],
			jumpIds: [],
		};
	}

	function create(): void {
		void run(async () => {
			if (active.value === 'connections') {
				const input = newConnection();
				const record = await api.connections.create(input);
				if (passwordField.value) {
					const outcome = await api.connections.credential(record.id, record.version, {
						kind: 'password',
						password: passwordField.value,
					});
					if (outcome.status !== 'updated') throw new Error(outcome.status);
				}
			} else if (active.value === 'proxies') {
				await api.proxies.create({
					name: name.value,
					type: 'SOCKS5',
					host: host.value,
					port: port.value,
					username: user.value || null,
					...(passwordField.value ? { password: passwordField.value } : {}),
				});
			} else if (active.value === 'tags') {
				await api.tags.create(name.value);
			} else {
				await api.sshKeys.create({ name: name.value, privateKey: secretKey.value });
			}
			passwordField.value = '';
			secretKey.value = '';
			await refresh();
			message.value = t('targetsNext.saved');
		});
	}

	function importOne(): void {
		void run(async () => {
			const item: TargetImportInput = {
				connection: newConnection(),
				tagNames: tagNames.value
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean),
			};
			const items = await api.connections.importMany([item]);
			if (items[0]?.status !== 'ok')
				throw new Error(items[0]?.status === 'error' ? items[0].code : 'import_failed');
			await refresh();
			message.value = t('targetsNext.saved');
		});
	}

	function rename(id: number, version: number): void {
		const updated = window.prompt(t('targetsNext.renamePrompt'));
		if (!updated) return;
		void run(async () => {
			const result =
				active.value === 'connections'
					? await api.connections.update(id, version, { name: updated })
					: active.value === 'proxies'
						? await api.proxies.update(id, version, { name: updated })
						: active.value === 'tags'
							? await api.tags.rename(id, version, updated)
							: await api.sshKeys.update(id, version, { name: updated });
			if (result.status !== 'updated') throw new Error(result.status);
			await refresh();
		});
	}

	function remove(id: number): void {
		if (!window.confirm(t('targetsNext.deleteConfirm'))) return;
		void run(async () => {
			if (active.value === 'connections') await api.connections.remove(id);
			else if (active.value === 'proxies') await api.proxies.remove(id);
			else if (active.value === 'tags') await api.tags.remove(id);
			else await api.sshKeys.remove(id);
			await refresh();
		});
	}

	function confirmHostKey(): void {
		if (!verifiedOutOfBand.value) {
			error.value = t('targetsNext.verifyFirst');
			return;
		}
		void run(async () => {
			await api.hostKeys.confirm(hostKeyHost.value, hostKeyPort.value, hostKeyFingerprint.value);
			verifiedOutOfBand.value = false;
			await refresh();
		});
	}

	function removeHostKey(host: string, port: number): void {
		if (!window.confirm(t('targetsNext.deleteConfirm'))) return;
		void run(async () => {
			await api.hostKeys.remove(host, port);
			await refresh();
		});
	}

	onMounted(() => void checkSession());
</script>

<template>
	<main class="mx-auto max-w-4xl space-y-4 p-6">
		<h1 class="text-xl font-semibold">{{ t('targetsNext.title') }}</h1>
		<p class="text-sm">{{ t('targetsNext.isolation') }}</p>
		<p class="text-xs">/__next/ → NEXUS_VITE_BACKEND_NEXT_ORIGIN</p>
		<p v-if="error" role="alert" class="text-red-600">{{ error }}</p>
		<p v-if="message" role="status">{{ message }}</p>
		<form v-if="!loggedIn" class="space-y-3" @submit.prevent="login">
			<h2>{{ setupNeeded ? t('targetsNext.setup') : t('targetsNext.login') }}</h2>
			<label class="block"
				>{{ t('targetsNext.username') }}
				<input v-model="username" autocomplete="username" class="border p-2" required />
			</label>
			<label class="block"
				>{{ t('targetsNext.password') }}
				<input
					v-model="password"
					type="password"
					:autocomplete="setupNeeded ? 'new-password' : 'current-password'"
					class="border p-2"
					required
				/>
			</label>
			<button type="submit" :disabled="busy" class="rounded border px-3 py-2">
				{{ t('targetsNext.continue') }}
			</button>
		</form>
		<template v-else>
			<button class="rounded border px-3 py-2" :disabled="busy" @click="logout">
				{{ t('targetsNext.logout') }}
			</button>
			<p class="text-sm">{{ t('targetsNext.terminalScope') }}</p>
			<section class="space-y-2 rounded border p-3">
				<h2 class="font-semibold">{{ t('targetsNext.hostKeyTitle') }}</h2>
				<p class="text-sm">{{ t('targetsNext.hostKeyWarning') }}</p>
				<form class="grid gap-2 sm:grid-cols-3" @submit.prevent="confirmHostKey">
					<label
						>{{ t('targetsNext.host') }}
						<input v-model="hostKeyHost" class="block w-full border p-2" required />
					</label>
					<label
						>{{ t('targetsNext.port') }}
						<input
							v-model.number="hostKeyPort"
							class="block w-full border p-2"
							type="number"
							min="1"
							max="65535"
							required
						/>
					</label>
					<label
						>{{ t('targetsNext.hostKeyFingerprint') }}
						<input
							v-model="hostKeyFingerprint"
							class="block w-full border p-2"
							placeholder="SHA256:…"
							required
						/>
					</label>
					<label class="sm:col-span-3">
						<input v-model="verifiedOutOfBand" type="checkbox" />
						{{ t('targetsNext.hostKeyVerified') }}
					</label>
					<button :disabled="busy || !verifiedOutOfBand" class="rounded border px-3 py-2">
						{{ t('targetsNext.hostKeyConfirm') }}
					</button>
				</form>
				<ul>
					<li
						v-for="hostKey in trustedHosts"
						:key="hostKey.host + ':' + hostKey.port"
						class="flex flex-wrap gap-2 py-1"
					>
						<span>{{ hostKey.host }}:{{ hostKey.port }} — {{ hostKey.fingerprint }}</span>
						<button
							class="rounded border px-2"
							:disabled="busy"
							@click="removeHostKey(hostKey.host, hostKey.port)"
						>
							{{ t('targetsNext.delete') }}
						</button>
					</li>
				</ul>
			</section>
			<div class="flex flex-wrap gap-2">
				<button
					v-for="tab in ['connections', 'proxies', 'tags', 'keys'] as const"
					:key="tab"
					class="rounded border px-3 py-2"
					:aria-pressed="active === tab"
					@click="active = tab"
				>
					{{ t('targetsNext.' + tab) }}
				</button>
				<button class="rounded border px-3 py-2" :disabled="busy" @click="void run(refresh)">
					{{ t('targetsNext.refresh') }}
				</button>
			</div>
			<form class="grid gap-2 sm:grid-cols-2" @submit.prevent="create">
				<label
					>{{ t('targetsNext.name') }}<input v-model="name" class="block w-full border p-2" required
				/></label>
				<template v-if="active === 'connections' || active === 'proxies'">
					<label
						>{{ t('targetsNext.host') }}<input v-model="host" class="block w-full border p-2" required
					/></label>
					<label
						>{{ t('targetsNext.port')
						}}<input
							v-model.number="port"
							type="number"
							min="1"
							max="65535"
							class="block w-full border p-2"
							required
					/></label>
					<label
						>{{ t('targetsNext.username') }}<input v-model="user" class="block w-full border p-2"
					/></label>
					<label
						>{{ t('targetsNext.password')
						}}<input v-model="passwordField" type="password" class="block w-full border p-2"
					/></label>
				</template>
				<label v-if="active === 'keys'" class="sm:col-span-2"
					>{{ t('targetsNext.privateKey') }}
					<textarea v-model="secretKey" class="block w-full border p-2" required />
				</label>
				<button type="submit" :disabled="busy" class="rounded border px-3 py-2">
					{{ t('targetsNext.create') }}
				</button>
			</form>
			<div v-if="active === 'connections'" class="flex gap-2">
				<label>{{ t('targetsNext.tags') }}<input v-model="tagNames" class="border p-2" /></label>
				<button :disabled="busy" class="rounded border px-3 py-2" @click="importOne">
					{{ t('targetsNext.import') }}
				</button>
			</div>
			<ul class="divide-y">
				<li
					v-for="record in active === 'connections'
						? connections
						: active === 'proxies'
							? proxies
							: active === 'tags'
								? tags
								: keys"
					:key="record.id"
					class="flex items-center justify-between gap-4 py-2"
				>
					<span>{{ record.name }} (#{{ record.id }}, v{{ record.version }})</span>
					<span class="flex gap-2">
						<button :disabled="busy" class="rounded border px-2" @click="rename(record.id, record.version)">
							{{ t('targetsNext.rename') }}
						</button>
						<button :disabled="busy" class="rounded border px-2" @click="remove(record.id)">
							{{ t('targetsNext.delete') }}
						</button>
					</span>
				</li>
			</ul>
			<section class="space-y-2 rounded border p-3">
				<h2 class="font-semibold">{{ t('targetsNext.terminalTitle') }}</h2>
				<label class="block">
					{{ t('targetsNext.connections') }}
					<select v-model.number="selectedRemoteId" class="block w-full border p-2">
						<option :value="null">{{ t('targetsNext.selectTarget') }}</option>
						<option
							v-for="item in connections.filter((row) => row.type === 'SSH')"
							:key="item.id"
							:value="item.id"
						>
							{{ item.name }} ({{ item.host }}:{{ item.port }})
						</option>
					</select>
				</label>
				<RemoteNextTerminal
					v-if="selectedRemoteId !== null"
					:key="selectedRemoteId"
					:target-id="selectedRemoteId"
				/>
			</section>
		</template>
	</main>
</template>
