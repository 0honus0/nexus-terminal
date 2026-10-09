<script setup lang="ts">
	import { onBeforeUnmount, nextTick, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import { openRemoteTerminal, type RemoteTerminalHandle } from '../transport/remote-terminal';

	const props = defineProps<{ targetId: number }>();
	const { t } = useI18n();
	const host = ref<HTMLElement | null>(null);
	const active = ref(false);
	const connecting = ref(false);
	const issue = ref('');
	let terminal: Terminal | null = null;
	let handle: RemoteTerminalHandle | null = null;
	let fit: FitAddon | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let destroyed = false;

	async function connect(): Promise<void> {
		if (connecting.value || active.value || !host.value) return;
		connecting.value = true;
		issue.value = '';
		try {
			await nextTick();
			const term = new Terminal({ allowProposedApi: false, convertEol: true, scrollback: 2000 });
			const addon = new FitAddon();
			term.loadAddon(addon);
			term.open(host.value);
			addon.fit();
			terminal = term;
			fit = addon;
			term.onData((data) => {
				if (!handle) return;
				try {
					handle.input(data);
				} catch (error) {
					issue.value = error instanceof Error ? error.message : 'remote_unavailable';
				}
			});
			resizeObserver = new ResizeObserver(() => {
				if (!handle) return;
				try {
					fit?.fit();
					handle.resize(term.cols, term.rows);
				} catch {
					/* the socket may have just closed */
				}
			});
			resizeObserver.observe(host.value);
			const opened = await openRemoteTerminal(
				{ targetId: props.targetId, columns: term.cols, rows: term.rows, term: 'xterm-256color' },
				{
					output(bytes) {
						return new Promise<void>((resolve) => {
							if (destroyed || term.element === undefined) {
								resolve();
								return;
							}
							term.write(bytes, () => resolve());
						});
					},

					closed() {
						active.value = false;
						handle = null;
					},

					failure(code) {
						issue.value = code;
					},
				},
			);
			if (destroyed) {
				await opened.close();
				return;
			}
			handle = opened;
			active.value = true;
			term.focus();
		} catch (error) {
			issue.value = error instanceof Error ? error.message : 'remote_unavailable';
		} finally {
			connecting.value = false;
		}
	}

	function disconnect(): void {
		const current = handle;
		handle = null;
		active.value = false;
		if (current) void current.close();
		resizeObserver?.disconnect();
		resizeObserver = null;
		terminal?.dispose();
		terminal = null;
		fit = null;
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
			<button class="rounded border px-3 py-2" :disabled="!active" @click="disconnect">
				{{ t('targetsNext.closeTerminal') }}
			</button>
		</div>
		<p v-if="issue" role="alert" class="text-red-600">{{ issue }}</p>
		<div ref="host" class="min-h-64 rounded bg-black p-2" />
	</section>
</template>
