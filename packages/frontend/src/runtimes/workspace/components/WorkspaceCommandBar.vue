<script setup lang="ts">
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { focusRegistry } from '@/shared/focus/public';
	import { expandQuickCommand, useQuickCommands } from '@/features/quick-commands/public';
	import { useCommandHistory } from '@/features/command-history/public';
	import type { UserPreferences } from '@/features/preferences/public';
	import { applyTerminalModifiers, type TerminalModifierState } from '@/features/terminal/public';
	import { useFeedback } from '@/shared/feedback/public';
	const props = withDefaults(
		defineProps<{
			commandInputSyncTarget?: UserPreferences['commandInputSyncTarget'];
			quickCommandsGrouped?: boolean;
			showFileManagerButton?: boolean;
			showEditorButton?: boolean;
			showClearButton?: boolean;
			showFocusSwitchButton?: boolean;
			showSearchButton?: boolean;
			ready?: boolean;
			modelValue?: string;
			terminalSearchOpen?: boolean;
			terminalSearchTerm?: string;
			terminalModifiers?: TerminalModifierState;
			virtualKeyboardVisible?: boolean;
			dockerPaneActive?: boolean;
			nonTerminalPaneActive?: boolean;
			mobile?: boolean;
		}>(),
		{
			commandInputSyncTarget: 'none',
			quickCommandsGrouped: true,
			showFileManagerButton: false,
			showEditorButton: true,
			showClearButton: true,
			showFocusSwitchButton: true,
			showSearchButton: true,
			ready: true,
			terminalSearchOpen: false,
			terminalSearchTerm: '',
			mobile: false,
		},
	);
	const emit = defineEmits<{
		'update:modelValue': [value: string];
		'update:terminalSearchOpen': [open: boolean];
		'update:terminalSearchTerm': [term: string];
		send: [command: string, allSessions: boolean];
		clear: [];
		openFileManager: [];
		openEditor: [];
		openQuickCommands: [];
		openStatusMonitor: [];
		openSuspended: [];
		openFocusConfigurator: [];
		toggleVirtualKeyboard: [];
		toggleDockerPane: [];
		returnToTerminal: [];
		findSearchNext: [];
		findSearchPrevious: [];
		interaction: [];
		terminalInput: [data: string];
	}>();
	const { t } = useI18n();
	const feedback = useFeedback();
	const quickCommands = useQuickCommands();
	const commandHistory = useCommandHistory();
	// Keep an immediate local presentation value so Enter in the same input tick
	// cannot read the previous prop before Vue has rendered the v-model update back
	// down from the session-owned commandDraft.
	const command = ref(props.modelValue ?? '');
	const commandInput = ref<HTMLInputElement | null>(null);
	const root = ref<HTMLFormElement | null>(null);
	let unregisterCommandFocus: (() => void) | undefined;
	let unregisterSearchFocus: (() => void) | undefined;

	const activeInput = computed({
		get: () => (props.terminalSearchOpen ? props.terminalSearchTerm : command.value),

		set: (value: string) => {
			if (props.terminalSearchOpen) emit('update:terminalSearchTerm', value);
			else command.value = value;
		},
	});

	const resetTargetSelection = () => {
		if (props.commandInputSyncTarget === 'quickCommands') quickCommands.resetSelection();
		else if (props.commandInputSyncTarget === 'commandHistory') commandHistory.resetSelection();
	};

	const syncSearch = (value: string) => {
		if (props.commandInputSyncTarget === 'quickCommands') quickCommands.setSearch(value);
		else if (props.commandInputSyncTarget === 'commandHistory') commandHistory.setSearch(value);
	};

	const setTerminalSearchOpen = (open: boolean) => {
		emit('update:terminalSearchOpen', open);
		if (!open) emit('update:terminalSearchTerm', '');
		void nextTick(() => commandInput.value?.focus());
	};

	const toggleTerminalSearch = () => setTerminalSearchOpen(!props.terminalSearchOpen);

	const submit = () => {
		if (props.terminalSearchOpen) emit('findSearchNext');
		else send();
	};

	const send = (allSessions = false, value = command.value): boolean => {
		if (props.terminalSearchOpen || !props.ready || (allSessions && !value)) return false;
		emit('send', value, allSessions);
		command.value = '';
		resetTargetSelection();
		return true;
	};

	const sendSelected = (): boolean => {
		const quickCommand = props.commandInputSyncTarget === 'quickCommands' ? quickCommands.selected.value : null;
		if (quickCommand) {
			const expansion = expandQuickCommand(quickCommand.command, quickCommand.variables);
			if (!send(false, expansion.command)) return false;
			if (expansion.unresolvedVariables.length) {
				feedback.notifyWarning(
					t('quickCommands.form.warningUndefinedVariables', {
						variables: expansion.unresolvedVariables.join(', '),
					}),
				);
			}
			void quickCommands.recordUsage(quickCommand.id);
			return true;
		}
		const historyEntry = props.commandInputSyncTarget === 'commandHistory' ? commandHistory.selected.value : null;
		if (historyEntry) {
			return send(false, historyEntry.command);
		}
		return false;
	};

	const captureStickyTerminalInput = (input: string): boolean => {
		if (!props.terminalModifiers || applyTerminalModifiers(input, props.terminalModifiers) === null) return false;
		emit('terminalInput', input);
		return true;
	};

	const handleSearchKeydown = (event: KeyboardEvent): boolean => {
		if (!props.terminalSearchOpen) return false;
		if (event.ctrlKey && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			commandInput.value?.focus();
			return true;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			setTerminalSearchOpen(false);
			return true;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			if (event.shiftKey) emit('findSearchPrevious');
			else emit('findSearchNext');
			return true;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			emit('findSearchPrevious');
			return true;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			emit('findSearchNext');
			return true;
		}
		return false;
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (handleSearchKeydown(event)) return;
		if (event.ctrlKey && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			setTerminalSearchOpen(true);
			return;
		}
		if (!event.isComposing && captureStickyTerminalInput(event.key)) {
			event.preventDefault();
			return;
		}
		if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(event.key)) emit('interaction');
		if (event.ctrlKey && event.key.toLowerCase() === 'c' && command.value === '') {
			event.preventDefault();
			emit('send', '\x03', false);
			return;
		}
		if (event.key === 'ArrowDown' && props.commandInputSyncTarget !== 'none') {
			event.preventDefault();
			if (props.commandInputSyncTarget === 'quickCommands') quickCommands.selectNext(props.quickCommandsGrouped);
			else commandHistory.selectNext();
			return;
		}
		if (event.key === 'ArrowUp' && props.commandInputSyncTarget !== 'none') {
			event.preventDefault();
			if (props.commandInputSyncTarget === 'quickCommands')
				quickCommands.selectPrevious(props.quickCommandsGrouped);
			else commandHistory.selectPrevious();
			return;
		}
		if (event.key === 'Enter' && !event.altKey && sendSelected()) {
			event.preventDefault();
			return;
		}
		if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(event.key)) resetTargetSelection();
	};

	const handleBeforeInput = (event: InputEvent) => {
		if (props.terminalSearchOpen || event.isComposing || event.inputType !== 'insertText' || !event.data) return;
		if (!captureStickyTerminalInput(event.data)) return;
		event.preventDefault();
	};

	watch(
		() => props.modelValue,
		(value) => {
			const next = value ?? '';
			if (next !== command.value) command.value = next;
		},
	);
	watch(command, (value) => {
		if (value !== (props.modelValue ?? '')) emit('update:modelValue', value);
		syncSearch(value);
	});
	watch(
		() => props.commandInputSyncTarget,
		() => {
			quickCommands.resetSelection();
			commandHistory.resetSelection();
			syncSearch(command.value);
		},
	);
	watch(
		() => props.terminalSearchOpen,
		(open) => {
			if (open) void nextTick(() => commandInput.value?.focus());
		},
	);
	onMounted(() => {
		const visible = () => Boolean(root.value?.getClientRects().length);

		unregisterCommandFocus = focusRegistry.register(
			'commandInput',
			() => {
				if (props.terminalSearchOpen) setTerminalSearchOpen(false);
				else commandInput.value?.focus();
				return true;
			},
			visible,
		);
		unregisterSearchFocus = focusRegistry.register(
			'terminalSearch',
			() => {
				if (!props.terminalSearchOpen) setTerminalSearchOpen(true);
				else commandInput.value?.focus();
				return true;
			},
			visible,
		);
	});
	onBeforeUnmount(() => {
		unregisterCommandFocus?.();
		unregisterSearchFocus?.();
	});
</script>
<template>
	<form
		ref="root"
		class="command-bar-root flex w-full items-center overflow-hidden bg-background"
		:class="mobile ? 'command-bar-root--mobile' : 'command-bar-root--desktop'"
		@submit.prevent="submit"
	>
		<div class="command-bar-inner flex w-full min-w-0 flex-1 items-center">
			<div
				class="command-entry"
				:class="{ 'command-entry--search': terminalSearchOpen, 'command-entry--mobile': mobile }"
			>
				<span v-if="terminalSearchOpen" class="command-entry__prompt" aria-hidden="true">
					<i class="fas fa-search"></i>
				</span>
				<input
					ref="commandInput"
					v-model="activeInput"
					:data-focus-id="terminalSearchOpen ? 'terminalSearch' : 'commandInput'"
					type="text"
					:aria-label="t(terminalSearchOpen ? 'commandInputBar.searchLabel' : 'commandInputBar.commandLabel')"
					:placeholder="terminalSearchOpen ? t('commandInputBar.searchPlaceholder') : ''"
					:disabled="!ready && !terminalSearchOpen"
					:aria-disabled="!ready && !terminalSearchOpen"
					class="command-bar-input"
					@keydown="handleKeydown"
					@beforeinput="handleBeforeInput"
					@blur="resetTargetSelection"
				/>
			</div>

			<div v-if="mobile" class="mobile-command-controls">
				<button
					v-if="showClearButton"
					type="button"
					class="command-bar-button"
					:title="t('commandInputBar.clearTerminal')"
					:aria-label="t('commandInputBar.clearTerminal')"
					@click="emit('clear')"
				>
					<i class="fas fa-eraser" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="command-bar-button"
					:title="t('layout.pane.quickCommands')"
					:aria-label="t('layout.pane.quickCommands')"
					@click="emit('openQuickCommands')"
				>
					<i class="fas fa-bolt" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="command-bar-button"
					:title="t('layout.pane.statusMonitor')"
					:aria-label="t('layout.pane.statusMonitor')"
					@click="emit('openStatusMonitor')"
				>
					<i class="fas fa-tachometer-alt" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="command-bar-button"
					:title="t(virtualKeyboardVisible ? 'commandInputBar.hideKeyboard' : 'commandInputBar.showKeyboard')"
					:aria-label="
						t(virtualKeyboardVisible ? 'commandInputBar.hideKeyboard' : 'commandInputBar.showKeyboard')
					"
					:aria-pressed="Boolean(virtualKeyboardVisible)"
					@click="emit('toggleVirtualKeyboard')"
				>
					<i
						class="fas fa-keyboard"
						:class="{ 'opacity-50': !virtualKeyboardVisible }"
						aria-hidden="true"
					></i>
				</button>
				<button
					v-if="showSearchButton || terminalSearchOpen"
					type="button"
					class="command-bar-button"
					:class="{ 'is-active': terminalSearchOpen }"
					:title="t(terminalSearchOpen ? 'commandInputBar.closeSearch' : 'commandInputBar.openSearch')"
					:aria-label="t(terminalSearchOpen ? 'commandInputBar.closeSearch' : 'commandInputBar.openSearch')"
					@click="toggleTerminalSearch"
				>
					<i :class="terminalSearchOpen ? 'fas fa-times' : 'fas fa-search'" aria-hidden="true"></i>
				</button>
				<template v-if="terminalSearchOpen">
					<button
						type="button"
						class="command-bar-button"
						:title="t('commandInputBar.findPrevious')"
						:aria-label="t('commandInputBar.findPrevious')"
						@click="emit('findSearchPrevious')"
					>
						<i class="fas fa-arrow-up" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="command-bar-button"
						:title="t('commandInputBar.findNext')"
						:aria-label="t('commandInputBar.findNext')"
						@click="emit('findSearchNext')"
					>
						<i class="fas fa-arrow-down" aria-hidden="true"></i>
					</button>
				</template>
				<button
					v-if="showFileManagerButton"
					type="button"
					class="command-bar-button"
					:title="t('layout.pane.fileManager')"
					:aria-label="t('layout.pane.fileManager')"
					@click="emit('openFileManager')"
				>
					<i class="fas fa-folder" aria-hidden="true"></i>
				</button>
				<button
					v-if="showEditorButton"
					type="button"
					class="command-bar-button"
					:title="t('layout.pane.editor')"
					:aria-label="t('layout.pane.editor')"
					@click="emit('openEditor')"
				>
					<i class="fas fa-edit" aria-hidden="true"></i>
				</button>
				<button
					type="button"
					class="command-bar-button"
					:class="{ 'is-active': dockerPaneActive }"
					:title="t('layout.pane.dockerManager')"
					:aria-label="t('layout.pane.dockerManager')"
					:aria-pressed="Boolean(dockerPaneActive)"
					@click="emit('toggleDockerPane')"
				>
					<i class="fab fa-docker" aria-hidden="true"></i>
				</button>
				<button
					v-if="nonTerminalPaneActive && !dockerPaneActive"
					type="button"
					class="command-bar-button"
					:title="t('layout.pane.terminal')"
					:aria-label="t('layout.pane.terminal')"
					@click="emit('returnToTerminal')"
				>
					<i class="fas fa-terminal" aria-hidden="true"></i>
				</button>
			</div>

			<div v-else class="desktop-command-controls">
				<template v-if="terminalSearchOpen">
					<button
						type="button"
						class="command-bar-button command-search-extra"
						:title="t('commandInputBar.findPrevious')"
						:aria-label="t('commandInputBar.findPrevious')"
						@click="emit('findSearchPrevious')"
					>
						<i class="fas fa-arrow-up" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="command-bar-button command-search-extra"
						:title="t('commandInputBar.findNext')"
						:aria-label="t('commandInputBar.findNext')"
						@click="emit('findSearchNext')"
					>
						<i class="fas fa-arrow-down" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="command-bar-button"
						:title="t('commandInputBar.closeSearch')"
						:aria-label="t('commandInputBar.closeSearch')"
						@click="toggleTerminalSearch"
					>
						<i class="fas fa-times" aria-hidden="true"></i>
					</button>
				</template>
				<template v-else>
					<button
						v-if="showClearButton"
						type="button"
						class="command-bar-button command-bar-secondary"
						:title="t('commandInputBar.clearTerminal')"
						:aria-label="t('commandInputBar.clearTerminal')"
						@click="emit('clear')"
					>
						<i class="fas fa-eraser" aria-hidden="true"></i>
					</button>
					<button
						v-if="showFocusSwitchButton"
						type="button"
						class="command-bar-button command-bar-secondary"
						:title="t('commandInputBar.configureFocusSwitch')"
						:aria-label="t('commandInputBar.configureFocusSwitch')"
						@click="emit('openFocusConfigurator')"
					>
						<i class="fas fa-keyboard" aria-hidden="true"></i>
					</button>
					<button
						v-if="showFileManagerButton"
						type="button"
						class="command-bar-button command-bar-secondary"
						:title="t('layout.pane.fileManager')"
						:aria-label="t('layout.pane.fileManager')"
						@click="emit('openFileManager')"
					>
						<i class="fas fa-folder" aria-hidden="true"></i>
					</button>
					<button
						v-if="showEditorButton"
						type="button"
						class="command-bar-button command-bar-secondary"
						:title="t('layout.pane.editor')"
						:aria-label="t('layout.pane.editor')"
						@click="emit('openEditor')"
					>
						<i class="fas fa-edit" aria-hidden="true"></i>
					</button>
					<button
						v-if="showSearchButton"
						type="button"
						class="command-bar-button command-search-toggle"
						:title="t('commandInputBar.openSearch')"
						:aria-label="t('commandInputBar.openSearch')"
						@click="toggleTerminalSearch"
					>
						<i class="fas fa-search" aria-hidden="true"></i>
					</button>
				</template>
			</div>
		</div>
	</form>
</template>

<style scoped>
	.command-bar-root {
		container-type: size;
		container-name: command-bar-pane;
		width: 100%;
		min-width: 0;
		background: var(--app-bg-color);
	}

	.command-bar-root--desktop {
		height: 100%;
		min-height: 0;
		flex: 0 0 auto;
		padding: 2px 6px;
		--command-dock-height: clamp(22px, calc(100cqh - 4px), 34px);
		--command-control-size: clamp(20px, calc(100cqh - 8px), 28px);
	}

	.command-bar-root--mobile {
		height: auto;
		min-height: 38px;
		flex: 0 0 auto;
		padding: 4px 6px;
	}

	.command-bar-inner {
		min-width: 0;
		min-height: 0;
		flex-wrap: nowrap;
		gap: 4px;
		overflow: hidden;
	}

	.command-entry {
		--command-entry-padding-inline: 10px;
		--command-entry-prompt-width: 11px;
		--command-entry-gap: 7px;
		display: flex;
		min-width: calc(2 * var(--command-entry-padding-inline) + 2px);
		height: var(--command-dock-height, 30px);
		flex: 1 1 0;
		align-items: center;
		gap: var(--command-entry-gap);
		padding-inline: var(--command-entry-padding-inline);
		border: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
		border-radius: 9px;
		background: color-mix(in srgb, var(--input-bg-color) 72%, transparent);
		box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-rim, white) 5%, transparent);
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.command-entry:hover {
		border-color: color-mix(in srgb, var(--border-hover-color, var(--border-color)) 58%, transparent);
		background: color-mix(in srgb, var(--input-bg-color) 86%, transparent);
	}

	.command-entry:focus-within {
		border-color: color-mix(in srgb, var(--primary-color) 48%, var(--border-color));
		background: var(--input-bg-color);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 13%, transparent);
	}

	.command-entry--search {
		min-width: calc(
			var(--command-entry-prompt-width) + var(--command-entry-gap) + 2 * var(--command-entry-padding-inline) + 2px
		);
		border-color: color-mix(in srgb, var(--primary-color) 42%, var(--border-color));
		background: color-mix(in srgb, var(--input-bg-color) 88%, transparent);
	}

	.command-entry--mobile {
		width: auto;
		max-width: none;
		height: 32px;
		flex: 1 1 0;
		padding-inline: 9px;
	}

	.command-entry__prompt {
		display: grid;
		width: var(--command-entry-prompt-width);
		flex: 0 0 var(--command-entry-prompt-width);
		place-items: center;
		color: var(--text-color-secondary);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		line-height: 1;
		user-select: none;
		transition: color 0.15s ease;
	}

	.command-entry--search .command-entry__prompt {
		color: var(--primary-color);
	}

	.command-bar-input {
		width: 100%;
		min-width: 0;
		height: 100%;
		flex: 1 1 auto;
		border: 0;
		outline: none;
		padding: 0;
		background: transparent;
		box-shadow: none;
		color: var(--text-color);
		font-size: 12px;
		line-height: 1;
	}

	.command-bar-input::placeholder {
		color: var(--input-placeholder-color, var(--text-color-secondary));
	}

	.command-bar-input:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.desktop-command-controls {
		display: flex;
		min-width: 0;
		flex: 0 1 auto;
		align-items: center;
		gap: 2px;
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
	}

	.desktop-command-controls::-webkit-scrollbar {
		display: none;
	}

	.mobile-command-controls {
		display: flex;
		min-width: 0;
		width: max-content;
		max-width: 100%;
		flex: 0 1 auto;
		align-items: center;
		justify-content: flex-start;
		overflow-x: auto;
		overflow-y: hidden;
		gap: 2px;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
	}

	.mobile-command-controls::-webkit-scrollbar {
		display: none;
	}

	.command-bar-button {
		position: relative;
		display: flex;
		width: var(--command-control-size, 30px);
		height: var(--command-control-size, 30px);
		min-width: var(--command-control-size, 30px);
		min-height: var(--command-control-size, 30px);
		flex: 0 0 var(--command-control-size, 30px);
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--border-color) 34%, transparent);
		border-radius: 7px;
		background: transparent;
		color: var(--text-color-secondary);
		transition:
			transform 0.12s ease,
			background-color 0.16s ease,
			color 0.16s ease;
	}

	.command-bar-root--mobile .command-bar-button {
		width: 32px;
		height: 32px;
		min-width: 32px;
		min-height: 32px;
		flex-basis: 32px;
	}

	.command-bar-root--mobile .command-bar-button i {
		font-size: 0.82rem;
	}

	.command-bar-button:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--border-color) 58%, transparent);
		background: color-mix(in srgb, var(--text-color) 7%, transparent);
		color: var(--text-color);
	}

	.command-bar-button:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--link-active-color) 50%, transparent);
	}

	.command-bar-button:active:not(:disabled) {
		transform: scale(0.92);
	}

	.command-bar-button:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.command-bar-button i {
		font-size: 0.76rem;
		line-height: 1;
		pointer-events: none;
	}

	.command-bar-button.is-active {
		border-color: color-mix(in srgb, var(--primary-color) 42%, transparent);
		background: color-mix(in srgb, var(--primary-color) 16%, transparent);
		color: var(--primary-color);
	}

	.command-bar-secondary {
		display: inline-flex;
	}

	@container command-bar-pane (max-width: 300px) {
		.command-search-extra {
			display: none;
		}
	}

	@container command-bar-pane (max-width: 170px) {
		.command-entry {
			--command-entry-padding-inline: 6px;
		}

		.command-bar-button {
			width: 22px;
			height: 22px;
			min-width: 22px;
			min-height: 22px;
			flex-basis: 22px;
		}
	}

	@media (hover: none) {
		.command-bar-root--mobile .command-bar-button {
			touch-action: manipulation;
		}

		.command-bar-root--mobile .command-bar-button:hover:not(:active) {
			background-color: transparent;
			color: var(--text-color-secondary);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.command-entry,
		.command-bar-button {
			transition: none;
		}
	}
</style>
