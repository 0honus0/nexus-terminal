<script setup lang="ts">
	import type { ReferenceElement } from 'reka-ui';
	import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue';
	import ArtifactPicker from '../../files/ArtifactPicker.vue';
	import type { ManagedArtifact } from '../../model/artifact-types';
	import type { HostArtifactPickerRequest } from './host-artifact-selection-types';
	import { AgentManagementFailure } from '../../model/management-failure';

	interface PendingPicker {
		request: HostArtifactPickerRequest;
		signal: AbortSignal;
		opened: boolean;
		cleanup(): void;
		resolve(items: ManagedArtifact[]): void;
		reject(error: unknown): void;
	}

	const props = withDefaults(defineProps<{ appId: string; appNames?: Record<string, string>; active?: boolean }>(), {
		appNames: () => ({}),

		active: true,
	});
	const picker = ref<InstanceType<typeof ArtifactPicker> | null>(null);
	const request = shallowRef<HostArtifactPickerRequest | null>(null);
	const selected = ref<ManagedArtifact[]>([]);
	let pending: PendingPicker | null = null;

	const anchor = computed<ReferenceElement>(() => {
		const current = request.value;
		if (!current) return { getBoundingClientRect: () => new DOMRect() };
		return {
			contextElement: current.element,

			getBoundingClientRect() {
				const position = current.anchor();
				return new DOMRect(position.left, position.top, position.width, position.height);
			},
		};
	});

	function close(): void {
		const current = pending;
		pending = null;
		current?.cleanup();
		picker.value?.close();
		current?.reject(new AgentManagementFailure('cancelled', 'not_dispatched'));
	}

	function onOpenChange(opened: boolean): void {
		const current = pending;
		if (!current) return;
		if (opened) {
			current.opened = true;
			return;
		}
		if (!current.opened) return;
		pending = null;
		current.cleanup();
		current.resolve(selected.value.slice());
	}

	async function show(current: PendingPicker): Promise<void> {
		await nextTick();
		if (pending !== current) return;
		if (
			current.signal.aborted ||
			!props.active ||
			props.appId !== current.request.appId ||
			!current.request.element.isConnected ||
			!picker.value
		) {
			close();
			return;
		}
		picker.value.open();
	}

	function open(value: HostArtifactPickerRequest, signal: AbortSignal): Promise<ManagedArtifact[]> {
		close();
		if (signal.aborted || !props.active || props.appId !== value.appId || !value.element.isConnected) {
			return Promise.reject(new AgentManagementFailure('cancelled', 'not_dispatched'));
		}
		request.value = value;
		selected.value = value.items.slice();
		return new Promise((resolve, reject) => {
			const abort = (): void => {
				if (pending === current) close();
			};

			const current: PendingPicker = {
				request: value,
				signal,
				opened: false,

				cleanup: () => signal.removeEventListener('abort', abort),

				resolve,
				reject,
			};
			pending = current;
			signal.addEventListener('abort', abort, { once: true });
			void show(current).catch((error: unknown) => {
				if (pending !== current) return;
				pending = null;
				current.cleanup();
				picker.value?.close();
				current.reject(error);
			});
		});
	}

	watch(() => [props.appId, props.active], close, { flush: 'sync' });
	onDeactivated(close);
	onBeforeUnmount(close);
	defineExpose({ open, close });
</script>

<template>
	<ArtifactPicker
		ref="picker"
		v-model="selected"
		class="absolute h-0 w-0"
		:app-id="props.appId"
		:app-names="props.appNames"
		:active="props.active"
		:anchor="anchor"
		@open-change="onOpenChange"
	/>
</template>
