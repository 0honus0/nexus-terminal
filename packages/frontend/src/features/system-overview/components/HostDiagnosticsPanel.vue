<script setup lang="ts">
	import { onMounted, ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiSpinner } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { getHostDiagnostics } from '../api/diagnostics-api';
	import type { HostDiagnostics } from '../model/diagnostic-types';

	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t } = useI18n();
	const diagnostics = shallowRef<HostDiagnostics | null>(null);
	const busy = ref(false);
	const failed = ref(false);
	const view = useAuthenticatedViewScope({
		available: () => props.active,

		onRevoke: () => {
			diagnostics.value = null;
			busy.value = false;
			failed.value = false;
		},
	});

	async function refresh(): Promise<void> {
		const signal = view.capture();
		if (signal.aborted || busy.value) {
			return;
		}
		busy.value = true;
		failed.value = false;
		try {
			const value = await getHostDiagnostics(signal);
			if (view.isCurrent(signal)) {
				diagnostics.value = value;
			}
		} catch {
			if (view.isCurrent(signal)) {
				failed.value = true;
			}
		} finally {
			if (view.isCurrent(signal)) {
				busy.value = false;
			}
		}
	}

	onMounted(() => void refresh());
	watch(
		() => props.active,
		(active) => {
			if (active) {
				void refresh();
			}
		},
	);
</script>

<template>
	<section class="mt-4 space-y-3 rounded-xl border border-border bg-card p-6" data-host-diagnostics>
		<div class="flex items-center gap-3">
			<h2 class="font-semibold">{{ t('systemOverview.diagnostics.title') }}</h2>
			<UiButton :disabled="busy" @click="refresh">{{ t('common.refresh') }}</UiButton>
		</div>
		<UiSpinner v-if="busy" />
		<p v-if="failed" role="alert">{{ t('systemOverview.diagnostics.failed') }}</p>
		<dl v-if="diagnostics" class="grid gap-2 sm:grid-cols-2">
			<dt>{{ t('systemOverview.diagnostics.runtime') }}</dt>
			<dd>{{ diagnostics.process.runtimeVersion }}</dd>
			<dt>{{ t('systemOverview.diagnostics.uptime') }}</dt>
			<dd>{{ diagnostics.process.uptimeSeconds }} s</dd>
			<dt>{{ t('systemOverview.diagnostics.resident') }}</dt>
			<dd>{{ Math.round(diagnostics.process.residentBytes / 1024 / 1024) }} MiB</dd>
			<dt>{{ t('systemOverview.diagnostics.heap') }}</dt>
			<dd>{{ Math.round(diagnostics.process.heapUsedBytes / 1024 / 1024) }} MiB</dd>
			<dt>{{ t('systemOverview.diagnostics.database') }}</dt>
			<dd>
				{{
					diagnostics.database.available
						? diagnostics.database.schemaVersion
						: t('systemOverview.diagnostics.unavailable')
				}}
			</dd>
			<dt>{{ t('systemOverview.diagnostics.collectedAt') }}</dt>
			<dd>{{ new Date(diagnostics.collectedAt).toLocaleString() }}</dd>
		</dl>
	</section>
</template>
