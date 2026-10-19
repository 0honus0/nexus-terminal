<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { ConnectionSummary } from '@/features/connections/public';
	import { UiButton } from '@/foundation/ui';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	const props = defineProps<{ items: ConnectionSummary[]; modelValue: string[]; max: number }>();
	const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();
	const { t } = useI18n();
	const query = ref('');
	useAuthenticatedViewScope({
		onRevoke() {
			query.value = '';
		},
	});
	const visible = computed(() =>
		props.items.filter((item) =>
			[item.name, item.host, String(item.id)].some((text) =>
				text.toLowerCase().includes(query.value.toLowerCase()),
			),
		),
	);
	const missing = computed(() =>
		props.modelValue.filter((id) => !props.items.some((item) => String(item.id) === id)),
	);
	const full = computed(() => props.modelValue.length >= props.max);
	const visibleSelection = computed(() => [
		...new Set([...props.modelValue, ...visible.value.map((item) => String(item.id))]),
	]);

	function toggle(id: string): void {
		if (props.modelValue.includes(id)) {
			emit(
				'update:modelValue',
				props.modelValue.filter((value) => value !== id),
			);
		} else if (!full.value) {
			emit('update:modelValue', [...props.modelValue, id]);
		}
	}

	function selectVisible(): void {
		if (visibleSelection.value.length <= props.max) {
			emit('update:modelValue', visibleSelection.value);
		}
	}
</script>
<template>
	<div class="space-y-2 text-sm">
		<label class="block"
			>{{ t('agent.settings.appManagement.searchTargets')
			}}<input v-model="query" class="mt-1 w-full rounded border border-border bg-background p-2"
		/></label>
		<p>{{ t('agent.settings.appManagement.targetCount', { count: modelValue.length, max }) }}</p>
		<div class="flex gap-2">
			<UiButton type="button" :disabled="visibleSelection.length > max" @click="selectVisible">{{
				t('agent.settings.appManagement.selectVisible')
			}}</UiButton
			><UiButton
				type="button"
				@click="
					emit(
						'update:modelValue',
						modelValue.filter((id) => !visible.some((item) => String(item.id) === id)),
					)
				"
				>{{ t('agent.settings.appManagement.clearVisible') }}</UiButton
			>
		</div>
		<div class="max-h-64 space-y-2 overflow-y-auto">
			<label v-for="item in visible" :key="item.id" class="flex items-center gap-2"
				><input
					type="checkbox"
					:checked="modelValue.includes(String(item.id))"
					:disabled="full && !modelValue.includes(String(item.id))"
					@change="toggle(String(item.id))"
				/>{{ item.name }} · {{ item.host }} · #{{ item.id }}</label
			>
			<label v-for="id in missing" :key="id" class="flex items-center gap-2 text-warning"
				><input type="checkbox" checked @change="toggle(id)" />{{
					t('agent.settings.appManagement.missingTarget', { id })
				}}</label
			>
		</div>
	</div>
</template>
