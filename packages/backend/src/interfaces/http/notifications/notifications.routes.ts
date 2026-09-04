import { Router } from 'express';
import type { NotificationSettingsService } from '../../../modules/notifications/notification-settings.service';
import type {
  CreateNotificationSetting,
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationSetting,
  UpdateNotificationSetting,
} from '../../../modules/notifications/notification.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import { errorMessage, isRecord, parsePositiveId } from '../shared/http-utils';
import { route } from '../shared/route-handler';

const channelTypes = new Set<NotificationChannelType>(['webhook', 'email', 'telegram']);

const readChannelType = (value: unknown): NotificationChannelType => {
  if (typeof value !== 'string' || !channelTypes.has(value as NotificationChannelType))
    throw new Error('channelType 无效。');
  return value as NotificationChannelType;
};

const readConfig = (value: unknown): NotificationChannelConfig => {
  if (!isRecord(value)) throw new Error('config 必须是对象。');
  return value as unknown as NotificationChannelConfig;
};

const readEnabledEvents = (value: unknown): CreateNotificationSetting['enabledEvents'] => {
  if (!Array.isArray(value) || !value.every((event) => typeof event === 'string'))
    throw new Error('enabledEvents 必须是字符串数组。');
  return value as CreateNotificationSetting['enabledEvents'];
};

const createInput = (body: unknown): CreateNotificationSetting => {
  if (!isRecord(body)) throw new Error('请求体必须是对象。');
  if (typeof body.name !== 'string') throw new Error('name 必须是字符串。');
  if (typeof body.enabled !== 'boolean') throw new Error('enabled 必须是布尔值。');
  return {
    channelType: readChannelType(body.channelType),
    name: body.name,
    enabled: body.enabled,
    config: readConfig(body.config),
    enabledEvents: readEnabledEvents(body.enabledEvents),
  };
};

const updateInput = (body: unknown): UpdateNotificationSetting => {
  if (!isRecord(body)) throw new Error('请求体必须是对象。');
  const input: UpdateNotificationSetting = {};
  if (body.channelType !== undefined) input.channelType = readChannelType(body.channelType);
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') throw new Error('name 必须是字符串。');
    input.name = body.name;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new Error('enabled 必须是布尔值。');
    input.enabled = body.enabled;
  }
  if (body.config !== undefined) input.config = readConfig(body.config);
  if (body.enabledEvents !== undefined) input.enabledEvents = readEnabledEvents(body.enabledEvents);
  return input;
};

const notificationDto = (setting: NotificationSetting) => {
  const config = { ...setting.config } as Record<string, unknown>;
  if (setting.channelType === 'email') delete config.smtpPass;
  if (setting.channelType === 'telegram') delete config.botToken;
  return { ...setting, config };
};

export const createNotificationsRouter = (settings: NotificationSettingsService): Router => {
  const router = Router();
  router.use(requireAuthenticated);
  router.get(
    '/',
    route(async (_request, response) => {
      response.json((await settings.list()).map(notificationDto));
    }),
  );
  router.post(
    '/test-unsaved',
    route(async (request, response) => {
      try {
        if (!isRecord(request.body)) throw new Error('请求体必须是对象。');
        const channelType = readChannelType(request.body.channelType);
        const config = readConfig(request.body.config);
        const result = await settings.test(channelType, config);
        response.status(result.success ? 200 : 400).json(result);
      } catch (error) {
        response.status(400).json({ message: errorMessage(error) });
      }
    }),
  );
  router.post(
    '/',
    route(async (request, response) => {
      try {
        const id = await settings.create(createInput(request.body));
        const setting = await settings.get(id);
        if (!setting) throw new Error('创建通知设置后无法检索。');
        response.status(201).json(notificationDto(setting));
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
        if (!(await settings.update(id, updateInput(request.body)))) {
          response.status(404).json({ message: `通知设置 ${id} 未找到。` });
          return;
        }
        const setting = await settings.get(id);
        if (!setting) {
          response.status(404).json({ message: `通知设置 ${id} 未找到。` });
          return;
        }
        response.json(notificationDto(setting));
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
