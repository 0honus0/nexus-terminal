<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import type {
		NativeRun,
		NativeChild,
		NativeMessage,
		NativeEvent,
		NativeRunAction,
	} from '../model/native-run-types';
	import { isNativeRunActive } from '../model/native-run-rules';
	import NativeAuditPanel from './NativeAuditPanel.vue';

	defineProps<{
		appId: string;
		run: NativeRun;
		events: NativeEvent[];
		auditToolId: string;
		children: NativeChild[];
		child: NativeChild | null;
		messages: NativeMessage[];
		active: boolean;
		disabled: boolean;
	}>();
	const emit = defineEmits<{
		refresh: [];
		mutate: [action: NativeRunAction];
		messages: [child: NativeChild, more: boolean];
	}>();
	const { t, locale } = useI18n();

	function statusDotClass(status: NativeRun['status']): string {
		if (status === 'running') return 'bg-success';
		if (status === 'pending' || status === 'unknown') return 'bg-warning';
		if (status === 'failed') return 'bg-error';
		return 'bg-text-secondary/50';
	}

	function profileLabel(profile: NativeChild['profile']): string {
		return t(`agent.settings.execution.profileNames.${profile}`);
	}

	function formatTime(value: number): string {
		return new Date(value * 1000).toLocaleString(locale.value);
	}
</script>
<template>
	<section class="space-y-3 text-xs">
		<section class="rounded-xl border border-border/70 bg-card p-3.5 shadow-xs">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<div class="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
						{{ t('agent.tasks.runOverview') }}
					</div>
					<div class="mt-1.5 flex items-center gap-1.5">
						<span class="h-2 w-2 shrink-0 rounded-full" :class="statusDotClass(run.status)"></span>
						<strong class="truncate text-xs text-foreground">{{
							t('agent.nativeRun.states.' + run.status)
						}}</strong>
					</div>
				</div>
				<div class="flex shrink-0 items-center gap-1">
					<UiButton
						density="compact"
						appearance="ghost"
						icon-only
						:title="t('agent.nativeRun.read')"
						:aria-label="t('agent.nativeRun.read')"
						:disabled="disabled"
						@click="emit('refresh')"
					>
						<i class="fa-solid fa-rotate text-[9px]" aria-hidden="true"></i>
					</UiButton>
					<UiButton
						v-if="isNativeRunActive(run)"
						density="compact"
						appearance="soft"
						tone="danger"
						:disabled="disabled"
						@click="emit('mutate', { kind: 'cancel', run })"
					>
						{{ t('agent.nativeRun.cancel') }}
					</UiButton>
				</div>
			</div>

			<div class="mt-3 grid grid-cols-2 gap-2 border-t border-border/50 pt-2.5 text-[11px]">
				<div class="rounded-lg border border-border/40 bg-background/50 p-2">
					<div class="text-text-secondary">{{ t('agent.tasks.startedAt') }}</div>
					<div class="mt-0.5 font-mono text-[10px] text-foreground">{{ formatTime(run.createdAt) }}</div>
				</div>
				<div class="rounded-lg border border-border/40 bg-background/50 p-2">
					<div class="text-text-secondary">{{ t('agent.tasks.updatedAt') }}</div>
					<div class="mt-0.5 font-mono text-[10px] text-foreground">{{ formatTime(run.updatedAt) }}</div>
				</div>
			</div>
		</section>

		<section v-if="children.length" class="space-y-2">
			<header class="flex items-center justify-between px-1">
				<h4 class="text-xs font-semibold text-foreground">{{ t('agent.nativeRun.children') }}</h4>
				<span class="rounded-full bg-header px-2 py-0.5 text-[10px] text-text-secondary">{{
					children.length
				}}</span>
			</header>
			<article
				v-for="item in children"
				:key="item.id"
				class="rounded-xl border border-border/70 bg-card p-3 shadow-xs"
			>
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<div class="flex items-center gap-1.5">
							<span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="statusDotClass(item.status)"></span>
							<strong class="truncate text-xs text-foreground">{{ profileLabel(item.profile) }}</strong>
						</div>
						<div class="mt-1 text-[11px] text-text-secondary">
							{{ t('agent.nativeRun.states.' + item.status) }}
						</div>
					</div>
					<UiButton
						v-if="isNativeRunActive(item)"
						density="compact"
						appearance="soft"
						tone="danger"
						:disabled="disabled"
						@click="emit('mutate', { kind: 'cancelChild', run, child: item })"
					>
						{{ t('agent.nativeRun.cancel') }}
					</UiButton>
				</div>
				<div class="mt-2.5 flex items-center justify-between gap-2 border-t border-border/45 pt-2">
					<span class="text-[10px] text-text-secondary">
						{{ t('agent.nativeRun.expires') }}: {{ formatTime(item.deadlineAt) }}
					</span>
					<UiButton
						density="compact"
						appearance="soft"
						:disabled="disabled"
						@click="emit('messages', item, false)"
					>
						{{ t('agent.nativeRun.messages') }}
					</UiButton>
				</div>
				<details class="mt-2 text-[10px] text-text-secondary">
					<summary class="cursor-pointer select-none">{{ t('agent.nativeRun.technicalDetails') }}</summary>
					<code class="mt-1 block break-all"
						>{{ item.id }} · parent {{ item.parentId }} · v{{ item.version }}</code
					>
				</details>
			</article>
		</section>

		<section v-if="child" class="rounded-xl border border-border/70 bg-card p-3 shadow-xs">
			<header class="flex items-center justify-between gap-2">
				<div class="min-w-0">
					<h4 class="text-xs font-semibold text-foreground">{{ t('agent.nativeRun.messages') }}</h4>
					<p class="mt-1 truncate text-[11px] text-text-secondary">{{ profileLabel(child.profile) }}</p>
				</div>
				<UiButton
					density="compact"
					appearance="ghost"
					:disabled="disabled"
					@click="emit('messages', child, true)"
				>
					{{ t('agent.nativeRun.moreMessages') }}
				</UiButton>
			</header>
			<p class="mt-2 rounded-lg bg-background/55 px-2.5 py-2 text-[10px] leading-4 text-text-secondary">
				{{ t('agent.nativeRun.metadataOnly') }}
			</p>
			<ul class="mt-2 space-y-1.5">
				<li
					v-for="message in messages"
					:key="message.sequence"
					class="rounded-lg border border-border/45 bg-background/45 px-2.5 py-2 text-[11px]"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="font-medium text-foreground">#{{ message.sequence }}</span>
						<span class="text-text-secondary">{{ message.bodyBytes }} bytes</span>
					</div>
					<details class="mt-1 text-[10px] text-text-secondary">
						<summary class="cursor-pointer select-none">
							{{ t('agent.nativeRun.technicalDetails') }}
						</summary>
						<code class="mt-1 block break-all"
							>{{ message.senderId }} · {{ formatTime(message.expiresAt) }}</code
						>
					</details>
				</li>
			</ul>
		</section>

		<details class="rounded-xl border border-border/70 bg-card p-3 shadow-xs">
			<summary class="cursor-pointer text-[11px] font-medium text-text-secondary hover:text-foreground">
				{{ t('agent.nativeRun.technicalDetails') }}
			</summary>
			<dl
				class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[10px] text-text-secondary"
			>
				<dt>Run</dt>
				<dd class="break-all text-foreground">{{ run.id }}</dd>
				<dt>Version</dt>
				<dd class="text-foreground">{{ run.version }}</dd>
				<dt>App</dt>
				<dd class="break-all text-foreground">{{ run.appId }}</dd>
				<dt>Thread</dt>
				<dd class="break-all text-foreground">{{ run.threadId }}</dd>
			</dl>
			<details class="mt-2 rounded-lg border border-border/45 bg-background/45 p-2">
				<summary class="cursor-pointer text-[10px] font-medium text-text-secondary">
					{{ t('agent.nativeRun.events') }}
				</summary>
				<ul class="mt-1.5 max-h-40 space-y-1 overflow-auto font-mono text-[10px] text-text-secondary">
					<li v-for="event in events" :key="event.sequence" class="break-all">
						#{{ event.sequence }} · {{ event.type }} · v{{ event.runVersion }}
					</li>
				</ul>
			</details>
			<NativeAuditPanel
				:key="run.id + ':' + auditToolId"
				class="mt-2"
				:app-id="appId"
				:run-id="run.id"
				:initial-tool-id="auditToolId"
				:active="active"
				:disabled="disabled"
			/>
		</details>
	</section>
</template>
