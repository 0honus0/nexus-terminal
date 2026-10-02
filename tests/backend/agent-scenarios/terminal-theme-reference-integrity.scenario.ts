import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteAppearanceSettingsRepository } from '../../../packages/backend/src/infrastructure/database/repositories/sqlite-appearance-settings.repository';
import { SqliteTerminalThemeRepository } from '../../../packages/backend/src/infrastructure/database/repositories/sqlite-terminal-theme.repository';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { TerminalThemeService } from '../../../packages/backend/src/modules/terminal-themes/terminal-theme.service';

export const terminalThemeReferenceIntegrityScenario = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-terminal-theme-reference-'));
  const db = new DatabaseAdapter({
    dataDirectory: directory,
    filename: 'terminal-theme-reference.sqlite',
    nodeEnv: 'test',
  });
  try {
    await db.initialize();
    const appearance = new SqliteAppearanceSettingsRepository(db);
    const repository = new SqliteTerminalThemeRepository(db);
    const themes = new TerminalThemeService(repository);
    const active = await themes.create({
      name: 'active-user-theme',
      themeData: { foreground: '#eeeeee', background: '#111111' },
    });
    const retained = await themes.create({
      name: 'retained-user-theme',
      themeData: { foreground: '#dddddd', background: '#222222' },
    });
    await appearance.setMany({ activeTerminalThemeId: String(active.id) });

    assert.equal(await themes.delete(retained.id), true);
    assert.equal(
      (await appearance.list()).find((row) => row.key === 'activeTerminalThemeId')?.value,
      String(active.id),
      'deleting a different theme must preserve the active reference',
    );

    assert.equal(await themes.delete(active.id), true);
    assert.equal(await themes.get(active.id), null);
    assert.equal(
      (await appearance.list()).find((row) => row.key === 'activeTerminalThemeId')?.value,
      'null',
      'deleting the active theme must clear its durable appearance reference atomically',
    );

    return [{ name: 'terminal_theme_active_reference_integrity', value: 2, unit: 'cases' }];
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
