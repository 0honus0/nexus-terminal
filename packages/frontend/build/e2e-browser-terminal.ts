export * as vue from 'vue';

export { default as TerminalView } from '../src/features/terminal/components/TerminalView.vue';

export { default as i18n } from '../src/app/i18n';

export { createTerminalSessionState } from '../src/features/terminal/state/terminalSessionState';

export { TerminalTypeAhead } from '../src/features/terminal/vendor/vscode-typeahead/prediction';
export { Terminal } from '@xterm/xterm';

export { SerializeAddon } from '@xterm/addon-serialize';
