export const defaultTerminalTheme: Record<string, string> = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

export const defaultUiTheme: Record<string, string> = {
  '--app-bg-color': '#ffffff',
  '--text-color': '#333333',
  '--text-color-secondary': '#666666',
  '--border-color': '#cccccc',
  '--link-color': '#8e44ad',
  '--link-hover-color': '#b180e0',
  '--link-active-color': '#a06cd5',
  '--link-active-bg-color': '#f3ebfb',
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)',
  '--header-bg-color': '#f0f0f0',
  '--footer-bg-color': '#f0f0f0',
  '--button-bg-color': '#a06cd5',
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#8e44ad',
  '--icon-color': 'var(--text-color-secondary)',
  '--icon-hover-color': 'var(--link-hover-color)',
  '--split-line-color': 'var(--border-color)',
  '--split-line-hover-color': 'var(--border-color)',
  '--input-bg-color': '#ffffff',
  '--input-text-color': 'var(--text-color)',
  '--input-placeholder-color': 'var(--text-color-secondary)',
  '--input-disabled-bg-color': '#f3f4f6',
  '--input-disabled-text-color': '#6b7280',
  '--input-disabled-border-color': '#d1d5db',
  '--input-focus-border-color': 'var(--link-active-color)',
  '--input-focus-glow': 'color-mix(in srgb, var(--link-active-color) 20%, transparent)',
  '--overlay-bg-color': 'rgb(0 0 0 / 60%)',
  '--status-success-color': '#28a745',
  '--status-warning-color': '#ffc107',
  '--status-error-color': '#dc3545',
  '--status-success-text-color': '#ffffff',
  '--status-warning-text-color': '#212529',
  '--status-error-text-color': '#ffffff',
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};

export const darkUiTheme: Record<string, string> = {
  ...defaultUiTheme,
  '--app-bg-color': '#212529',
  '--text-color': '#e9ecef',
  '--text-color-secondary': '#adb5bd',
  '--border-color': '#495057',
  '--link-color': '#bb86fc',
  '--link-hover-color': '#d1a9ff',
  '--link-active-color': '#a06cd5',
  '--link-active-bg-color': 'rgb(160 108 213 / 20%)',
  '--header-bg-color': '#343a40',
  '--footer-bg-color': '#343a40',
  '--button-bg-color': '#a06cd5',
  '--button-hover-bg-color': '#8e44ad',
  '--input-bg-color': '#2b3035',
  '--input-disabled-bg-color': '#343a40',
  '--input-disabled-text-color': '#adb5bd',
  '--input-disabled-border-color': '#495057',
  '--overlay-bg-color': 'rgb(0 0 0 / 80%)',
};

const isDarkColor = (color: string): boolean => {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 128;
};

export const normalizeUiTheme = (theme: Record<string, string>): Record<string, string> => {
  const normalized = { ...defaultUiTheme, ...theme };
  const dark = isDarkColor(normalized['--app-bg-color'] || '#ffffff');
  const fallback = (key: string, value: string): void => {
    if (!Object.prototype.hasOwnProperty.call(theme, key)) normalized[key] = value;
  };

  fallback('--input-bg-color', dark ? '#1e293b' : '#ffffff');
  fallback('--input-text-color', dark ? '#f8fafc' : normalized['--text-color']);
  fallback('--input-placeholder-color', dark ? '#94a3b8' : normalized['--text-color-secondary']);
  fallback('--input-disabled-bg-color', dark ? '#0b1220' : '#f3f4f6');
  fallback('--input-disabled-text-color', dark ? '#64748b' : '#6b7280');
  fallback('--input-disabled-border-color', dark ? '#334155' : '#d1d5db');
  return normalized;
};

export const defaultWindowThemeColor = '#343A40';
