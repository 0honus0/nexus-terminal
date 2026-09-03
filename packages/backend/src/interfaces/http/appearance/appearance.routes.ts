import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import multer from 'multer';
import type { AppearanceSettingsService } from '../../../modules/appearance/appearance-settings.service';
import type { BackgroundAssetService } from '../../../modules/appearance/background-asset.service';
import type { HtmlThemeService } from '../../../modules/appearance/html-theme.service';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage } from '../shared/http-utils';
import { route } from '../shared/route-handler';

const backgroundUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export const createAppearanceRouter = (dependencies: {
  appearance: AppearanceSettingsService;
  backgrounds: BackgroundAssetService;
  htmlThemes: HtmlThemeService;
}): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (_request, response) => {
      response.json(await dependencies.appearance.get());
    }),
  );
  router.put(
    '/',
    route(async (request, response) => {
      try {
        response.json(await dependencies.appearance.update(request.body ?? {}));
      } catch (error) {
        response.status(400).json({ message: '更新外观设置失败', error: errorMessage(error) });
      }
    }),
  );
  const uploadBackground = (kind: 'page' | 'terminal', field: string) =>
    [
      backgroundUpload.single(field),
      route(async (request, response) => {
        if (!request.file) {
          response.status(400).json({ message: '没有上传文件' });
          return;
        }
        try {
          const result = await dependencies.backgrounds.upload(kind, request.file.buffer, request.file.mimetype);
          response.json({ message: kind === 'page' ? '页面背景上传成功' : '终端背景上传成功', ...result });
        } catch (error) {
          response.status(400).json({ message: errorMessage(error) });
        }
      }),
    ] as const;
  router.post('/background/page', ...uploadBackground('page', 'pageBackgroundFile'));
  router.post('/background/terminal', ...uploadBackground('terminal', 'terminalBackgroundFile'));
  router.get(
    '/background/file/:filename',
    route(async (request, response) => {
      try {
        const content = await dependencies.backgrounds.read(String(request.params.filename));
        if (!content) {
          response.status(404).json({ message: '文件未找到' });
          return;
        }
        response.setHeader(
          'Content-Security-Policy',
          "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:",
        );
        response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Type', content.contentType);
        response.setHeader('Content-Length', String(content.size));
        await pipeline(content.stream, response);
      } catch (error) {
        if (!response.headersSent)
          response
            .status(errorMessage(error).includes('无效的文件名') ? 400 : 500)
            .json({ message: errorMessage(error) });
        else response.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    }),
  );
  router.delete(
    '/background/page',
    route(async (_request, response) => {
      await dependencies.backgrounds.remove('page');
      response.json({ message: '页面背景已移除' });
    }),
  );
  router.delete(
    '/background/terminal',
    route(async (_request, response) => {
      await dependencies.backgrounds.remove('terminal');
      response.json({ message: '终端背景已移除' });
    }),
  );
  router.get(
    '/html-presets/local',
    route(async (_request, response) => {
      response.json(await dependencies.htmlThemes.listLocal());
    }),
  );
  router.get(
    '/html-presets/local/:themeName',
    route(async (request, response) => {
      const content = await dependencies.htmlThemes.readLocal(String(request.params.themeName));
      if (content === null) {
        response.status(404).json({ message: `主题 '${String(request.params.themeName)}' 未找到` });
        return;
      }
      response.type('text/html; charset=utf-8').send(content);
    }),
  );
  router.post(
    '/html-presets/local',
    route(async (request, response) => {
      const { name, content } = request.body ?? {};
      if (typeof name !== 'string' || typeof content !== 'string' || !name || !content) {
        response.status(400).json({ message: '主题名称和内容不能为空' });
        return;
      }
      try {
        await dependencies.htmlThemes.createCustom(name, content);
        response.status(201).json({ message: '用户自定义 HTML 主题创建成功' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  router.put(
    '/html-presets/local/:themeName',
    route(async (request, response) => {
      if (typeof request.body?.content !== 'string') {
        response.status(400).json({ message: '主题内容不能为空' });
        return;
      }
      try {
        await dependencies.htmlThemes.updateCustom(String(request.params.themeName), request.body.content);
        response.json({ message: '用户自定义 HTML 主题更新成功' });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('未找到') ? 404 : 400).json({ message });
      }
    }),
  );
  router.delete(
    '/html-presets/local/:themeName',
    route(async (request, response) => {
      try {
        await dependencies.htmlThemes.deleteCustom(String(request.params.themeName));
        response.json({ message: '用户自定义 HTML 主题删除成功' });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('未找到') ? 404 : 400).json({ message });
      }
    }),
  );
  router.get(
    '/html-presets/remote/repository-url',
    route(async (_request, response) => {
      response.json({ url: await dependencies.htmlThemes.getRemoteRepositoryUrl() });
    }),
  );
  router.put(
    '/html-presets/remote/repository-url',
    route(async (request, response) => {
      if (request.body?.url === undefined) {
        response.status(400).json({ message: 'URL 不能为空或 undefined' });
        return;
      }
      try {
        await dependencies.htmlThemes.setRemoteRepositoryUrl(request.body.url || null);
        response.json({ message: '远程 HTML 主题仓库链接更新成功' });
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  router.get(
    '/html-presets/remote/list',
    route(async (request, response) => {
      try {
        response.json(
          await dependencies.htmlThemes.listRemote(
            typeof request.query.repoUrl === 'string' ? request.query.repoUrl : undefined,
          ),
        );
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  router.get(
    '/html-presets/remote/content',
    route(async (request, response) => {
      const fileUrl = typeof request.query.fileUrl === 'string' ? request.query.fileUrl : '';
      if (!fileUrl) {
        response.status(400).json({ message: 'fileUrl 查询参数不能为空' });
        return;
      }
      try {
        response.type('text/html; charset=utf-8').send(await dependencies.htmlThemes.readRemote(fileUrl));
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  return router;
};
