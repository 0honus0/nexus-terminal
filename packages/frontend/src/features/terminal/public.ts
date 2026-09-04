export { default as TerminalView } from './components/TerminalView.vue';
export { default as VirtualKeyboard } from './components/VirtualKeyboard.vue';
export type { TerminalChannel } from './ports/terminal-channel';
export type {
  TerminalConnectionState,
  TerminalOutput,
  TerminalSnapshot,
  TerminalViewport,
  TerminalVisualOptions,
} from './model/terminal';

export { createTerminalSessionState } from './state/terminalSessionState';
export type { TerminalSessionState } from './state/terminalSessionState';
export { applyTerminalModifiers } from './model/terminalModifiers';
export type { TerminalModifierState } from './model/terminalModifiers';
