import { Router } from 'express';
import {
  NOTIFICATION_CHANNEL_TYPES,
  NOTIFICATION_EVENTS,
  type NotificationConfigDto,
  type NotificationEventDto,
  type NotificationSettingCreateRequestDto,
  type NotificationSettingDto,
  type NotificationSettingUpdateRequestDto,
  type NotificationTestRequestDto,
  type NotificationTestResponseDto,
} from '@nexus-terminal/protocol/notifications';
import type { NotificationSettingsService } from '../../../modules/notifications/notification-settings.service';
import { isSecretWebhookHeader } from '../../../modules/notifications/webhook-header-secrets';
import type { WebhookConfig } from '../../../modules/notifications/notification.types';
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

const channelTypes = new Set<NotificationChannelType>(NOTIFICATION_CHANNEL_TYPES);
const notificationEvents = new Set<NotificationEventDto>(NOTIFICATION_EVENTS);

const readChannelType = (value: unknown): NotificationChannelType => {
  if (typeof value !== 'string' || !channelTypes.has(value as NotificationChannelType))
    throw new Error('channelType 无效。');
  return value as NotificationChannelType;
};

const readConfigDto = (value: unknown): NotificationConfigDto => {
  if (!isRecord(value)) throw new Error('config 必须是对象。');
  const config: NotificationConfigDto = {};
  const copyString = (key: keyof NotificationConfigDto): void => {
    const entry = value[key];
    if (entry === undefined) return;
    if (typeof entry !== 'string') throw new Error(`config.${String(key)} 必须是字符串。`);
    (config as Record<string, unknown>)[key] = entry;
  };
  for (const key of [
    'url',
    'bodyTemplate',
    'to',
    'smtpHost',
    'smtpUser',
    'smtpPass',
    'from',
    'botToken',
    'chatId',
    'messageTemplate',
    'customDomain',
  ] as const)
    copyString(key);
  if (value.method !== undefined) {
    if (value.method !== 'POST' && value.method !== 'GET' && value.method !== 'PUT')
      throw new Error('config.method 无效。');
    config.method = value.method;
  }
  if (value.headers !== undefined) {
    if (
      !isRecord(value.headers) ||
      !Object.values(value.headers).every((entry) => typeof entry === 'string' || entry === null)
    )
      throw new Error('config.headers 必须是字符串映射。');
    const names = Object.keys(value.headers).map((name) => name.toLowerCase());
    if (new Set(names).size !== names.length) throw new Error('config.headers 不允许大小写重复的 header 名称。');
    config.headers = value.headers as Record<string, string | null>;
  }
  if (value.secretHeaderNames !== undefined) {
    if (
      !Array.isArray(value.secretHeaderNames) ||
      !value.secretHeaderNames.every((name) => typeof name === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
    )
      throw new Error('config.secretHeaderNames 无效。');
    config.secretHeaderNames = value.secretHeaderNames as string[];
  }
  if (value.smtpPort !== undefined) {
    if (typeof value.smtpPort !== 'number' || !Number.isFinite(value.smtpPort))
      throw new Error('config.smtpPort 必须是数字。');
    config.smtpPort = value.smtpPort;
  }
  if (value.smtpSecure !== undefined) {
    if (typeof value.smtpSecure !== 'boolean') throw new Error('config.smtpSecure 必须是布尔值。');
    config.smtpSecure = value.smtpSecure;
  }
  return config;
};

const readConfig = (
  value: unknown,
  channelType: NotificationChannelType,
  allowMissingSecret = false,
  existingWebhook?: WebhookConfig,
): NotificationChannelConfig => {
  const config = readConfigDto(value);
  if (channelType === 'webhook') {
    if (typeof config.url !== 'string') throw new Error('webhook config.url 必须是字符串。');
    const headers =
      config.headers === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(config.headers).map(([name, value]) => {
              if (value !== null) return [name, value];
              const previousName = Object.keys(existingWebhook?.headers ?? {}).find(
                (key) => key.toLowerCase() === name.toLowerCase(),
              );
              if (
                !allowMissingSecret ||
                !previousName ||
                !existingWebhook ||
                !isSecretWebhookHeader(previousName, existingWebhook)
              )
                throw new Error('只能保留已有secret header。');
              return [name, existingWebhook.headers![previousName]];
            }),
          );
    if (existingWebhook && config.secretHeaderNames !== undefined) {
      for (const name of existingWebhook.secretHeaderNames ?? []) {
        const entry = Object.entries(config.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
        if (
          (config.headers === undefined || entry?.[1] === null) &&
          !config.secretHeaderNames.some((key) => key.toLowerCase() === name.toLowerCase())
        )
          throw new Error('取消secret标记需删除或显式替换header。');
      }
    }
    return {
      url: config.url,
      ...(config.method === undefined ? {} : { method: config.method }),
      ...(headers === undefined ? {} : { headers }),
      ...(config.secretHeaderNames === undefined ? {} : { secretHeaderNames: config.secretHeaderNames }),
      ...(config.bodyTemplate === undefined ? {} : { bodyTemplate: config.bodyTemplate }),
    };
  }
  if (channelType === 'email') {
    if (typeof config.to !== 'string') throw new Error('email config.to 必须是字符串。');
    return {
      to: config.to,
      ...(config.bodyTemplate === undefined ? {} : { bodyTemplate: config.bodyTemplate }),
      ...(config.smtpHost === undefined ? {} : { smtpHost: config.smtpHost }),
      ...(config.smtpPort === undefined ? {} : { smtpPort: config.smtpPort }),
      ...(config.smtpSecure === undefined ? {} : { smtpSecure: config.smtpSecure }),
      ...(config.smtpUser === undefined ? {} : { smtpUser: config.smtpUser }),
      ...(config.smtpPass === undefined ? {} : { smtpPass: config.smtpPass }),
      ...(config.from === undefined ? {} : { from: config.from }),
    };
  }
  if (typeof config.chatId !== 'string') throw new Error('telegram config.chatId 必须是字符串。');
  if (!allowMissingSecret && typeof config.botToken !== 'string')
    throw new Error('telegram config.botToken 必须是字符串。');
  return {
    botToken: config.botToken ?? '',
    chatId: config.chatId,
    ...(config.messageTemplate === undefined ? {} : { messageTemplate: config.messageTemplate }),
    ...(config.customDomain === undefined ? {} : { customDomain: config.customDomain }),
  };
};

const readEnabledEvents = (value: unknown): CreateNotificationSetting['enabledEvents'] => {
  if (
    !Array.isArray(value) ||
    !value.every((event) => typeof event === 'string' && notificationEvents.has(event as NotificationEventDto))
  )
    throw new Error('enabledEvents 包含无效事件。');
  return value as CreateNotificationSetting['enabledEvents'];
};

const createInput = (body: unknown): CreateNotificationSetting => {
  if (!isRecord(body)) throw new Error('请求体必须是对象。');
  const request = body as Partial<NotificationSettingCreateRequestDto>;
  if (typeof request.name !== 'string') throw new Error('name 必须是字符串。');
  if (typeof request.enabled !== 'boolean') throw new Error('enabled 必须是布尔值。');
  const channelType = readChannelType(request.channelType);
  return {
    channelType,
    name: request.name,
    enabled: request.enabled,
    config: readConfig(request.config, channelType),
    enabledEvents: readEnabledEvents(request.enabledEvents),
  };
};

const updateInput = (body: unknown, setting: NotificationSetting): UpdateNotificationSetting => {
  const channelType = setting.channelType;
  if (!isRecord(body)) throw new Error('请求体必须是对象。');
  const request = body as NotificationSettingUpdateRequestDto;
  const input: UpdateNotificationSetting = {};
  if (request.channelType !== undefined) input.channelType = readChannelType(request.channelType);
  if (request.name !== undefined) {
    if (typeof request.name !== 'string') throw new Error('name 必须是字符串。');
    input.name = request.name;
  }
  if (request.enabled !== undefined) {
    if (typeof request.enabled !== 'boolean') throw new Error('enabled 必须是布尔值。');
    input.enabled = request.enabled;
  }
  if (request.config !== undefined)
    input.config = readConfig(
      request.config,
      channelType,
      true,
      channelType === 'webhook' ? (setting.config as WebhookConfig) : undefined,
    );
  if (request.enabledEvents !== undefined) input.enabledEvents = readEnabledEvents(request.enabledEvents);
  return input;
};

const notificationDto = (setting: NotificationSetting): NotificationSettingDto => {
  const config: NotificationConfigDto = { ...setting.config };
  if (setting.channelType === 'email') delete config.smtpPass;
  if (setting.channelType === 'telegram') delete config.botToken;
  if (setting.channelType === 'webhook')
    config.headers = Object.fromEntries(
      Object.entries((setting.config as WebhookConfig).headers ?? {}).map(([name, value]) => [
        name,
        isSecretWebhookHeader(name, setting.config as WebhookConfig) ? null : value,
      ]),
    );
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
        const body = request.body as Partial<NotificationTestRequestDto>;
        const channelType = readChannelType(body.channelType);
        const config = readConfig(body.config, channelType);
        const payload: NotificationTestResponseDto = await settings.test(channelType, config);
        response.status(payload.success ? 200 : 400).json(payload);
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
        const existing = await settings.get(id);
        if (!existing) {
          response.status(404).json({ message: `通知设置 ${id} 未找到。` });
          return;
        }
        if (!(await settings.update(id, updateInput(request.body, existing)))) {
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
      const payload: NotificationTestResponseDto = await settings.test(setting.channelType, setting.config);
      response.status(payload.success ? 200 : 400).json(payload);
    }),
  );
  return router;
};
