import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const THEME_NAME = 'E2E Terminal Theme';
const UPDATED_NAME = 'E2E Terminal Theme Updated';
const IMPORTED_NAME = 'E2E Terminal Theme Imported';

const initialTheme = {
  foreground: '#d0d0d0',
  background: '#101010',
  cursor: '#f0f0f0',
  selectionBackground: '#303030',
};

const updatedTheme = {
  foreground: '#eeeeee',
  background: '#181818',
  cursor: '#ffcc00',
  selectionBackground: '#404040',
  blue: '#4488ff',
};

test('custom terminal theme supports create, conflict, update, export, import, and delete lifecycle', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);

  const cleanupByName = async (...names: string[]) => {
    const list = await request.get('/api/v1/terminal-themes');
    expect(list.ok()).toBeTruthy();
    const themes = (await list.json()) as Array<{ _id?: string; name: string; isPreset: boolean }>;
    for (const theme of themes.filter((item) => !item.isPreset && names.includes(item.name) && item._id)) {
      expect((await request.delete(`/api/v1/terminal-themes/${theme._id}`)).ok()).toBeTruthy();
    }
  };

  await cleanupByName(THEME_NAME, UPDATED_NAME, IMPORTED_NAME);
  let themeId = '';
  let importedId = '';

  try {
    await step('create a custom theme and fetch it by id', async () => {
      const create = await request.post('/api/v1/terminal-themes', {
        data: { name: THEME_NAME, themeData: initialTheme },
      });
      expect(create.status()).toBe(201);
      const created = (await create.json()) as {
        _id: string;
        name: string;
        isPreset: boolean;
        themeData: Record<string, string>;
      };
      themeId = created._id;
      expect(created).toMatchObject({ name: THEME_NAME, isPreset: false, themeData: initialTheme });

      const read = await request.get(`/api/v1/terminal-themes/${themeId}`);
      expect(read.ok()).toBeTruthy();
      await expect(read.json()).resolves.toMatchObject({ _id: themeId, name: THEME_NAME, themeData: initialTheme });
    });

    await step('duplicate names are rejected without overwriting the existing theme', async () => {
      const duplicate = await request.post('/api/v1/terminal-themes', {
        data: { name: THEME_NAME, themeData: updatedTheme },
      });
      expect(duplicate.status()).toBe(409);
      const original = await request.get(`/api/v1/terminal-themes/${themeId}`);
      await expect(original.json()).resolves.toMatchObject({ name: THEME_NAME, themeData: initialTheme });
    });

    await step('update changes both metadata and terminal colors', async () => {
      const update = await request.put(`/api/v1/terminal-themes/${themeId}`, {
        data: { name: UPDATED_NAME, themeData: updatedTheme },
      });
      expect(update.ok()).toBeTruthy();

      const read = await request.get(`/api/v1/terminal-themes/${themeId}`);
      expect(read.ok()).toBeTruthy();
      await expect(read.json()).resolves.toMatchObject({ name: UPDATED_NAME, themeData: updatedTheme });
    });

    let exportedTheme: Record<string, string> = {};
    await step('export returns the raw xterm theme JSON with a safe filename', async () => {
      const exported = await request.get(`/api/v1/terminal-themes/${themeId}/export`);
      expect(exported.ok()).toBeTruthy();
      expect(exported.headers()['content-type']).toContain('application/json');
      expect(exported.headers()['content-disposition']).toContain('e2e_terminal_theme_updated.json');
      exportedTheme = (await exported.json()) as Record<string, string>;
      expect(exportedTheme).toMatchObject(updatedTheme);
    });

    await step('an exported theme can be imported under a new name', async () => {
      const imported = await request.post('/api/v1/terminal-themes/import', {
        multipart: {
          name: IMPORTED_NAME,
          themeFile: {
            name: 'exported-theme.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(exportedTheme)),
          },
        },
      });
      expect(imported.status()).toBe(201);
      const body = (await imported.json()) as {
        _id: string;
        name: string;
        isPreset: boolean;
        themeData: Record<string, string>;
      };
      importedId = body._id;
      expect(body).toMatchObject({ name: IMPORTED_NAME, isPreset: false, themeData: updatedTheme });
    });

    await step('custom themes delete cleanly and no longer resolve by id', async () => {
      expect((await request.delete(`/api/v1/terminal-themes/${themeId}`)).ok()).toBeTruthy();
      expect((await request.get(`/api/v1/terminal-themes/${themeId}`)).status()).toBe(404);
      themeId = '';

      expect((await request.delete(`/api/v1/terminal-themes/${importedId}`)).ok()).toBeTruthy();
      expect((await request.get(`/api/v1/terminal-themes/${importedId}`)).status()).toBe(404);
      importedId = '';
    });
  } finally {
    if (themeId) await request.delete(`/api/v1/terminal-themes/${themeId}`).catch(() => undefined);
    if (importedId) await request.delete(`/api/v1/terminal-themes/${importedId}`).catch(() => undefined);
    await cleanupByName(THEME_NAME, UPDATED_NAME, IMPORTED_NAME);
  }
});
