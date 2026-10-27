<script setup lang="ts">
	import { computed, ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInlineNotice } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { getNativeToolCallDetails } from '../api/native-tools-api';
	import { AgentManagementFailure } from '../model/management-failure';
	import type { NativeTool, NativeToolCallDetails } from '../model/native-run-types';

	const props = defineProps<{ tool: NativeTool; active: boolean }>();
	const { t, te } = useI18n();
	const details = shallowRef<NativeToolCallDetails | null>(null);
	const failure = shallowRef<unknown>(null);
	const loading = ref(false);
	let request: AbortController | null = null;
	const scope = useAuthenticatedViewScope({
		available: () => props.active,

		onRevoke() {
			request?.abort();
			request = null;
			details.value = null;
			failure.value = null;
			loading.value = false;
		},
	});

	const formattedArguments = computed(() => {
		if (!details.value) return '';
		// The API decoder already verified an object. Render as text, never Markdown/HTML.
		const value: unknown = JSON.parse(details.value.argumentsJson);
		return JSON.stringify(value, null, 2);
	});
	const loadFailure = computed(() => {
		if (!failure.value) return '';
		const key =
			failure.value instanceof AgentManagementFailure
				? 'agent.nativeRun.requestFailureReasons.' + failure.value.code
				: '';
		return key && te(key) ? t(key) : t('agent.nativeRun.toolCallDetails.loadFailed');
	});
	const callFailure = computed(() => {
		const value = details.value;
		if (!value || !['failed', 'unknown', 'cancelled'].includes(value.tool.state)) return '';
		const reason =
			value.failureCode === null
				? ''
				: t('agent.nativeRun.failureReasons.' + value.failureCode, { tool: value.tool.toolName });
		if (value.tool.state === 'failed' && reason) return reason;
		return [t('agent.nativeRun.toolCallDetails.' + value.tool.state), reason].filter(Boolean).join(' ');
	});

	async function load(): Promise<void> {
		request?.abort();
		const permission = scope.capture();
		if (!scope.isCurrent(permission)) return;
		const current = new AbortController();
		request = current;
		const tool = props.tool;
		const revision = tool.revision;
		details.value = null;
		failure.value = null;
		loading.value = true;

		const isCurrent = () =>
			request === current &&
			scope.isCurrent(permission) &&
			props.tool.appId === tool.appId &&
			props.tool.runId === tool.runId &&
			props.tool.id === tool.id &&
			props.tool.revision === revision;

		try {
			const value = await getNativeToolCallDetails(tool, AbortSignal.any([permission, current.signal]));
			if (isCurrent()) details.value = value;
		} catch (cause) {
			if (isCurrent()) failure.value = cause;
		} finally {
			if (request === current) {
				request = null;
				loading.value = false;
			}
		}
	}

	watch(
		() => [props.active, props.tool.appId, props.tool.runId, props.tool.id, props.tool.revision],
		() => {
			if (props.active) void load();
		},
		{ immediate: true },
	);
</script>

<template>
	<section
		class="mb-3 min-w-0 space-y-2"
		:aria-label="t('agent.nativeRun.toolCallDetails.title')"
		:aria-busy="loading"
	>
		<p v-if="loading" role="status" class="text-[11px] text-text-secondary">{{ t('common.loading') }}</p>
		<UiInlineNotice v-else-if="loadFailure" tone="danger" compact>
			<p>{{ loadFailure }}</p>
			<UiButton class="mt-2" density="compact" appearance="ghost" @click="load">{{ t('common.retry') }}</UiButton>
		</UiInlineNotice>
		<template v-else-if="details">
			<UiInlineNotice v-if="callFailure" :tone="details.tool.state === 'unknown' ? 'warning' : 'danger'" compact>
				<p>{{ callFailure }}</p>
				<code v-if="details.failureCode" class="mt-1 block break-all text-[10px]">{{
					details.failureCode
				}}</code>
			</UiInlineNotice>
			<p class="text-[11px] font-medium text-text-secondary">
				{{ t('agent.nativeRun.toolCallDetails.arguments') }}
			</p>
			<pre
				class="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 px-2.5 py-2 font-mono text-[11px] leading-5 text-foreground/85 ring-1 ring-inset ring-border/30"
				data-tool-arguments
				>{{ formattedArguments }}</pre>
		</template>
	</section>
</template>
