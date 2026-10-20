<script setup lang="ts">
	import { watch } from 'vue';
	import { UiButton } from '@/foundation/ui';
	import { useI18n } from 'vue-i18n';
	import { createNativeThreadApi } from '../api/native-thread-api';
	import { useNativeThreads } from '../composables/use-native-threads';
	import type { NativeThread } from '../model/native-thread-types';

	const props = defineProps<{
		appId: string;
		active: boolean;
		disabled?: boolean;
		autoLoad?: boolean;
		apiBase?: '/api/v1/agent' | '/__next/api/v1/agent';
	}>();
	const emit = defineEmits<{ select: [value: NativeThread]; working: [value: boolean] }>();
	const { t } = useI18n();
	const editor = useNativeThreads(
		props.appId,
		createNativeThreadApi(props.apiBase),
		() => props.active,
		(value) => emit('select', value),
	);
	const { items, nextCursor, title, selected, pending, inspected, busy, refreshRequired, notice } = editor;
	watch(busy, (value) => emit('working', value), { flush: 'sync' });
	watch(
		() => props.active,
		(value) => {
			if (value && props.autoLoad) void editor.refresh();
		},
		{ immediate: true },
	);
</script>

<template>
	<section class="min-w-0 space-y-2">
		<h3 class="border-b border-border/45 pb-2 text-xs font-semibold text-foreground">
			{{ t('agent.nativeThreads.title') }}
		</h3>
		<p class="text-xs text-text-secondary">{{ t('agent.nativeThreads.scope') }}</p>

		<div class="flex flex-wrap gap-2">
			<UiButton
				appearance="soft"
				density="compact"
				class="rounded border px-2 py-1"
				:disabled="disabled || busy"
				@click="editor.refresh"
			>
				{{ t('agent.nativeThreads.read') }}
			</UiButton>
			<UiButton
				appearance="soft"
				density="compact"
				class="rounded border px-2 py-1"
				:disabled="disabled || busy || !!pending || refreshRequired"
				@click="editor.newThread"
			>
				{{ t('agent.nativeThreads.new') }}
			</UiButton>
			<UiButton
				appearance="soft"
				density="compact"
				v-if="nextCursor"
				class="rounded border px-2 py-1"
				:disabled="disabled || busy || refreshRequired"
				@click="editor.loadMore"
			>
				{{ t('agent.nativeThreads.more') }}
			</UiButton>
		</div>
		<ul class="max-h-48 space-y-1 overflow-auto">
			<li v-for="item in items" :key="item.id">
				<UiButton
					appearance="soft"
					density="compact"
					class="w-full rounded border p-2 text-left"
					:disabled="disabled || busy || !!pending"
					:aria-pressed="selected?.id === item.id"
					@click="editor.choose(item)"
				>
					{{ item.title }}
				</UiButton>
			</li>
		</ul>
		<form class="flex gap-2" @submit.prevent="editor.submit()">
			<input
				v-model="title"
				class="min-w-0 flex-1 border p-2"
				:disabled="disabled || busy || !!pending"
				:aria-label="t('agent.nativeThreads.name')"
				required
			/>
			<UiButton
				appearance="soft"
				density="compact"
				type="submit"
				class="rounded border px-2 py-1"
				:disabled="disabled || busy || refreshRequired || !!pending"
			>
				{{ t(selected ? 'agent.nativeThreads.rename' : 'agent.nativeThreads.create') }}
			</UiButton>
		</form>
		<p v-if="notice" role="status">{{ t('agent.settings.appManagement.' + notice) }}</p>
		<template v-if="pending">
			<p role="status">{{ t('agent.nativeThreads.unknown') }}</p>
			<UiButton
				appearance="soft"
				density="compact"
				class="rounded border px-2 py-1"
				:disabled="disabled || busy || !inspected || refreshRequired"
				@click="editor.submit(true)"
			>
				{{ t('agent.nativeThreads.retry') }}
			</UiButton>
			<UiButton
				appearance="soft"
				density="compact"
				class="rounded border px-2 py-1"
				:disabled="disabled || busy || !inspected"
				@click="editor.abandon"
			>
				{{ t('agent.nativeThreads.abandon') }}
			</UiButton>
		</template>
	</section>
</template>
