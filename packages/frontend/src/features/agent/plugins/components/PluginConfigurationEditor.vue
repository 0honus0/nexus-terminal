<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { isAgentRecord } from '@nexus-terminal/shared/agent/http-codec';
	import { UiCheckbox, UiFormField, UiInput, UiSelect, UiTextarea } from '@/foundation/ui';

	const props = defineProps<{ schemaJson: string; documentJson: string; disabled: boolean }>();
	const emit = defineEmits<{ 'update:documentJson': [value: string] }>();
	const { t } = useI18n();
	const document = computed<Record<string, unknown>>(() => {
		const value: unknown = JSON.parse(props.documentJson);
		return isAgentRecord(value) ? value : {};
	});
	const fields = computed(() => {
		const schema: unknown = JSON.parse(props.schemaJson);
		if (!isAgentRecord(schema) || !isAgentRecord(schema.properties)) return [];
		return Object.entries(schema.properties).flatMap(([key, value]) => {
			if (!isAgentRecord(value)) return [];
			return [
				{
					key,
					type: value.type,
					label: typeof value.title === 'string' ? value.title : key,
					description: typeof value.description === 'string' ? value.description : '',
					options: Array.isArray(value.enum)
						? value.enum
								.filter((item): item is string => typeof item === 'string')
								.map((item) => ({ value: item, label: item }))
						: [],
					multiline: value.type === 'object' || value.type === 'array',
				},
			];
		});
	});

	function text(key: string, structured: boolean): string {
		const value = document.value[key];
		return value === undefined ? '' : structured ? JSON.stringify(value, null, 2) : String(value);
	}

	function update(key: string, value: unknown): void {
		const next: unknown = JSON.parse(props.documentJson);
		if (!isAgentRecord(next)) return;
		Object.defineProperty(next, key, { value, enumerable: true, configurable: true, writable: true });
		emit('update:documentJson', JSON.stringify(next));
	}

	function structured(key: string, event: Event): void {
		if (!(event.target instanceof HTMLTextAreaElement)) return;
		try {
			const value: unknown = JSON.parse(event.target.value);
			update(key, value);
			event.target.setCustomValidity('');
		} catch {
			// Native validation keeps the draft visible and prevents submitting a malformed field.
			event.target.setCustomValidity(t('agent.settings.appManagement.invalid'));
		}
	}
</script>

<template>
	<div class="space-y-4">
		<UiFormField v-for="field in fields" :key="field.key" :label="field.label" :description="field.description">
			<UiCheckbox
				v-if="field.type === 'boolean'"
				:aria-label="field.label"
				:model-value="document[field.key] === true"
				:disabled="disabled"
				@update:model-value="update(field.key, $event)"
			/>
			<UiSelect
				v-else-if="field.options.length"
				:model-value="text(field.key, false)"
				:options="field.options"
				:disabled="disabled"
				@update:model-value="update(field.key, $event)"
			/>
			<UiTextarea
				v-else-if="field.multiline"
				:model-value="text(field.key, true)"
				:disabled="disabled"
				:min-rows="4"
				class="font-mono"
				@change="structured(field.key, $event)"
			/>
			<UiInput
				v-else
				:model-value="text(field.key, false)"
				:type="field.type === 'integer' || field.type === 'number' ? 'number' : 'text'"
				:disabled="disabled"
				@update:model-value="
					update(field.key, field.type === 'integer' || field.type === 'number' ? Number($event) : $event)
				"
			/>
		</UiFormField>
	</div>
</template>
