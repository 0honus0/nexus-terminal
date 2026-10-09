import { computed, reactive, type ComputedRef } from 'vue';
import type { TerminalModifierState } from '../model/terminalModifiers';

export type TerminalModifier = keyof TerminalModifierState;

export type StickyModifierLevel = 'off' | 'once' | 'locked';

export type StickyModifierLevels = Readonly<Record<TerminalModifier, StickyModifierLevel>>;

export interface StickyTerminalModifiers {
	readonly levels: StickyModifierLevels;
	readonly active: ComputedRef<TerminalModifierState>;
	/** Tap: off -> once; a second tap inside the double-tap window locks; otherwise turns it off. */
	toggle(modifier: TerminalModifier, now?: number): void;
	/** Called after one input consumed the modifiers; one-shot levels reset, locks stay. */
	consume(): void;
	clear(): void;
}

export const STICKY_MODIFIER_DOUBLE_TAP_MS = 350;

export function createStickyTerminalModifiers(): StickyTerminalModifiers {
	const levels = reactive<Record<TerminalModifier, StickyModifierLevel>>({ ctrl: 'off', alt: 'off', shift: 'off' });
	const armedAt: Record<TerminalModifier, number> = { ctrl: 0, alt: 0, shift: 0 };
	const active = computed<TerminalModifierState>(() => ({
		ctrl: levels.ctrl !== 'off',
		alt: levels.alt !== 'off',
		shift: levels.shift !== 'off',
	}));
	const modifiers: TerminalModifier[] = ['ctrl', 'alt', 'shift'];
	return {
		levels,
		active,

		toggle(modifier, now = Date.now()) {
			const level = levels[modifier];
			if (level === 'off') {
				levels[modifier] = 'once';
				armedAt[modifier] = now;
			} else if (level === 'once' && now - armedAt[modifier] <= STICKY_MODIFIER_DOUBLE_TAP_MS) {
				levels[modifier] = 'locked';
			} else {
				levels[modifier] = 'off';
			}
		},

		consume() {
			for (const modifier of modifiers) if (levels[modifier] === 'once') levels[modifier] = 'off';
		},

		clear() {
			for (const modifier of modifiers) levels[modifier] = 'off';
		},
	};
}
