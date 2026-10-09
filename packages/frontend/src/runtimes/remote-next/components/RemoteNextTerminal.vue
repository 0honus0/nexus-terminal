<script setup lang="ts">
	import { onBeforeUnmount, nextTick, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import { openRemoteTerminal, type RemoteTerminalHandle } from '../transport/remote-terminal';

	const props = defineProps<{ targetId: number }>();
	const { t, te } = useI18n();
	const host = ref<HTMLElement | null>(null);
	const active = ref(false);
	const connecting = ref(false);
	const issue = ref('');
	let generation = 0;
	let terminal: Terminal | null = null;
	let handle: RemoteTerminalHandle | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let openingAbort: AbortController | null = null;
	let destroyed = false;

	function failure(error: unknown): void {
		const code = typeof error === 'string' ? error : error instanceof Error ? error.message : 'remote_unavailable';
		const key = 'targetsNext.errors.' + code;
		issue.value = te(key) ? t(key) : t('targetsNext.errors.remote_unavailable');
	}

	/** Releases only this generation's transport, terminal and observers. */
	function dispose(current: number): void {
		if (generation !== current) {
			return;
		}
		generation += 1;
		openingAbort?.abort();
		openingAbort = null;
		const previous = handle;
		handle = null;
		active.value = false;
		connecting.value = false;
		resizeObserver?.disconnect();
		resizeObserver = null;
		terminal?.dispose();
		terminal = null;
		if (previous) {
			void previous.close().catch(failure);
		}
	}

	async function connect(): Promise<void> {
		if (connecting.value || active.value || !host.value || destroyed) {
			return;
		}
		const current = ++generation;
		const abort = new AbortController();
		openingAbort = abort;
		connecting.value = true;
		issue.value = '';
		try {
			await nextTick();
			if (generation !== current || !host.value) {
				return;
			}
			const term = new Terminal({ allowProposedApi: false, convertEol: true, scrollback: 2000 });
			const fit = new FitAddon();
			term.loadAddon(fit);
			term.open(host.value);
			fit.fit();
			terminal = term;
			term.onData((data) => {
				if (generation !== current || !handle) {
					return;
				}
				try {
					handle.input(data);
				} catch (error) {
					failure(error);
				}
			});
			const observer = new ResizeObserver(() => {
				if (generation !== current || !handle) {
					return;
				}
				try {
					fit.fit();
					handle.resize(term.cols, term.rows);
				} catch {
					// Transport closure is handled by the shared close promise.
				}
			});
			resizeObserver = observer;
			observer.observe(host.value);

			const opened = await openRemoteTerminal(
				{ targetId: props.targetId, columns: term.cols, rows: term.rows, term: 'xterm-256color' },
				{
					output(bytes) {
						return new Promise<void>((resolve) => {
							if (generation !== current || destroyed || !term.element) {
								resolve();
								return;
							}
							term.write(bytes, resolve);
						});
					},

					closed() {
						dispose(current);
					},

					failure,
				},
				abort.signal,
			);
			if (generation !== current || destroyed) {
				await opened.close().catch(failure);
				return;
			}
			handle = opened;
			active.value = true;
			term.focus();
		} catch (error) {
			if (generation === current && !destroyed) {
				failure(error);
			}
			dispose(current);
		} finally {
			if (generation === current) {
				openingAbort = null;
				connecting.value = false;
			}
		}
	}

	function disconnect(): void {
		dispose(generation);
	}

	onBeforeUnmount(() => {
		destroyed = true;
		disconnect();
	});
</script>

<template>
	<section class="space-y-2">
		<div class="flex items-center gap-2">
			<button class="rounded border px-3 py-2" :disabled="connecting || active" @click="connect">
				{{ t('targetsNext.openTerminal') }}
			</button>
			<button class="rounded border px-3 py-2" :disabled="!active && !connecting" @click="disconnect">
				{{ t('targetsNext.closeTerminal') }}
			</button>
		</div>
		<p v-if="issue" role="alert" class="text-red-600">{{ issue }}</p>
		<div ref="host" class="min-h-64 rounded bg-black p-2" />
	</section>
</template>
