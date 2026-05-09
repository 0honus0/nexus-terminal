import { describe, it, expect } from 'vitest';
import { presetTerminalThemes } from './iterm-themes';

describe('iterm-themes 配置', () => {
  it('应导出 presetTerminalThemes 数组', () => {
    expect(Array.isArray(presetTerminalThemes)).toBe(true);
    expect(presetTerminalThemes.length).toBeGreaterThan(0);
  });

  it('每个主题应包含必要的字段', () => {
    for (const theme of presetTerminalThemes) {
      expect(theme).toHaveProperty('_id');
      expect(theme).toHaveProperty('name');
      expect(theme).toHaveProperty('themeData');
      expect(typeof theme._id).toBe('string');
      expect(typeof theme.name).toBe('string');
    }
  });

  it('每个主题的 themeData 应包含基本颜色', () => {
    const requiredColors = [
      'foreground',
      'background',
      'cursor',
      'cursorAccent',
      'selectionBackground',
      'selectionForeground',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ];
    for (const theme of presetTerminalThemes) {
      for (const color of requiredColors) {
        expect(theme.themeData).toHaveProperty(color);
        expect(typeof theme.themeData[color as keyof typeof theme.themeData]).toBe('string');
      }
    }
  });

  it('主题 ID 应唯一', () => {
    const ids = presetTerminalThemes.map((t) => t._id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('主题名称应唯一', () => {
    const names = presetTerminalThemes.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('所有主题应标记为预设', () => {
    for (const theme of presetTerminalThemes) {
      expect(theme.isPreset).toBe(true);
    }
  });

  it('颜色值应为有效的十六进制颜色', () => {
    const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
    for (const theme of presetTerminalThemes) {
      expect(theme.themeData.foreground).toMatch(hexColorRegex);
      expect(theme.themeData.background).toMatch(hexColorRegex);
    }
  });
});
