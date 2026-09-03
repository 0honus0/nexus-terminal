import { Router } from 'express';
import type { NotificationSettingsService } from '../../../modules/notifications/notification-settings.service';
import type { NotificationChannelType } from '../../../modules/notifications/notification.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import {
  fromLegacyNotificationCreateDto,
  fromLegacyNotificationUpdateDto,
  toLegacyNotificationDto,
} from '../legacy-api/notification-http.mapper';
import { errorMessage, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

export const createNotificationsRouter = (settings: NotificationSettingsService): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (_request, response) => {
      response.json((await settings.list()).map(toLegacyNotificationDto));
    }),
  );
  router.post(
    '/test-unsaved',
    route(async (request, response) => {
      const channelType = request.body?.channel_type as NotificationChannelType | undefined;
      const config = request.body?.config;
      if (!channelType || !['webhook', 'email', 'telegram'].includes(channelType) || !config) {
        response.status(400).json({ message: '缺少或无效的通知测试配置。' });
        return;
      }
      const result = await settings.test(channelType, config);
      response.status(result.success ? 200 : 400).json(result);
    }),
  );
  router.post(
    '/',
    route(async (request, response) => {
      try {
        const id = await settings.create(fromLegacyNotificationCreateDto(request.body ?? {}));
        const setting = await settings.get(id);
        if (!setting) throw new Error('创建通知设置后无法检索。');
        response.status(201).json(toLegacyNotificationDto(setting));
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  router.put(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的通知设置 ID。' });
        return;
      }
      try {
        if (!(await settings.update(id, fromLegacyNotificationUpdateDto(request.body ?? {})))) {
          response.status(404).json({ message: `通知设置 ${id} 未找到。` });
          return;
        }
        const setting = await settings.get(id);
        if (!setting) {
          response.status(404).json({ message: `通知设置 ${id} 未找到。` });
          return;
        }
        response.json(toLegacyNotificationDto(setting));
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  router.delete(
    '/:id',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的通知设置 ID。' });
        return;
      }
      const setting = await settings.get(id);
      if (!setting) {
        response.status(404).json({ message: `通知设置 ${id} 未找到。` });
        return;
      }
      if (!(await settings.delete(id))) {
        response.status(404).json({ message: `通知设置 ${id} 未找到。` });
        return;
      }
      response.status(204).end();
    }),
  );
  router.post(
    '/:id/test',
    route(async (request, response) => {
      const id = parsePositiveId(String(request.params.id));
      if (!id) {
        response.status(400).json({ message: '无效的通知设置 ID。' });
        return;
      }
      const setting = await settings.get(id);
      if (!setting) {
        response.status(404).json({ message: `通知设置 ${id} 未找到。` });
        return;
      }
      const result = await settings.test(setting.channelType, setting.config);
      response.status(result.success ? 200 : 400).json(result);
    }),
  );
  return router;
};
