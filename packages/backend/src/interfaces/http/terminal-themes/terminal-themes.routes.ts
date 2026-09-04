import { Router } from 'express';
import multer from 'multer';
import type { TerminalThemeService } from '../../../modules/terminal-themes/terminal-theme.service';
import type { TerminalTheme, TerminalThemeData } from '../../../modules/terminal-themes/terminal-theme.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const terminalThemeDto = (theme: TerminalTheme) => ({
  id: theme.id,
  name: theme.name,
  themeData: theme.themeData,
  preset: theme.isPreset,
});

export const createTerminalThemesRouter = (themes: TerminalThemeService): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (_request, response) => {
      response.json((await themes.list()).map(terminalThemeDto));
    }),
  );
  router.post(
    '/import',
    upload.single('themeFile'),
    route(async (request, response) => {
      if (!request.file) {
        response.status(400).json({ message: '没有上传文件' });
        return;
      }
      if (request.file.mimetype !== 'application/json' && !request.file.originalname.toLowerCase().endsWith('.json')) {
        response.status(400).json({ message: '只允许上传 JSON 文件！' });
        return;
      }
      try {
        const data = JSON.parse(request.file.buffer.toString('utf8')) as TerminalThemeData;
        const fallbackName = request.file.originalname.replace(/\.json$/i, '');
        response
          .status(201)
          .json(
            terminalThemeDto(
              await themes.import(
                data,
                typeof request.body?.name === 'string' && request.body.name ? request.body.name : fallbackName,
              ),
            ),
          );
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(
            message.includes('JSON') || error instanceof SyntaxError ? 400 : message.includes('已存在') ? 409 : 400,
          )
          .json({ message: '导入终端主题失败', error: message });
      }
    }),
  );
  router.post(
    '/',
    route(async (request, response) => {
      try {
        response.status(201).json(terminalThemeDto(await themes.create(request.body)));
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('已存在') ? 409 : 400).json({ message: '创建终端主题失败', error: message });
      }
    }),
  );
  router.get(
    '/:id/export',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的主题 ID' });
        return;
      }
      const exported = await themes.export(id);
      if (!exported) {
        response.status(404).json({ message: '未找到指定的主题' });
        return;
      }
      response.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`);
      response.type('application/json').send(JSON.stringify(exported.themeData, null, 2));
    }),
  );
  router.get(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的主题 ID' });
        return;
      }
      const theme = await themes.get(id);
      if (!theme) {
        response.status(404).json({ message: '未找到指定的主题' });
        return;
      }
      response.json(terminalThemeDto(theme));
    }),
  );
  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的主题 ID' });
        return;
      }
      try {
        if (!(await themes.update(id, request.body))) {
          response.status(404).json({ message: '未找到可更新的主题或该主题为预设主题' });
          return;
        }
        response.json({ message: '主题更新成功' });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('已存在') ? 409 : 400).json({ message: '更新终端主题失败', error: message });
      }
    }),
  );
  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的主题 ID' });
        return;
      }
      if (!(await themes.delete(id))) {
        response.status(404).json({ message: '未找到可删除的主题或该主题为预设主题' });
        return;
      }
      response.json({ message: '主题删除成功' });
    }),
  );
  return router;
};
