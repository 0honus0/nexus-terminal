import type {
  CreateNotificationSetting,
  NotificationSetting,
  UpdateNotificationSetting,
} from '../../../modules/notifications/notification.types';

export interface LegacyNotificationWriteDto {
  channel_type?: CreateNotificationSetting['channelType'];
  channelType?: CreateNotificationSetting['channelType'];
  name?: string;
  enabled?: boolean;
  config?: CreateNotificationSetting['config'];
  enabled_events?: CreateNotificationSetting['enabledEvents'];
  enabledEvents?: CreateNotificationSetting['enabledEvents'];
}

export const fromLegacyNotificationCreateDto = (dto: LegacyNotificationWriteDto): CreateNotificationSetting => ({
  channelType: (dto.channel_type ?? dto.channelType) as CreateNotificationSetting['channelType'],
  name: dto.name ?? '',
  enabled: dto.enabled ?? false,
  config: dto.config as CreateNotificationSetting['config'],
  enabledEvents: dto.enabled_events ?? dto.enabledEvents ?? [],
});

export const fromLegacyNotificationUpdateDto = (dto: LegacyNotificationWriteDto): UpdateNotificationSetting => {
  const result: UpdateNotificationSetting = {};
  if (dto.channel_type !== undefined || dto.channelType !== undefined)
    result.channelType = dto.channel_type ?? dto.channelType;
  if (dto.name !== undefined) result.name = dto.name;
  if (dto.enabled !== undefined) result.enabled = dto.enabled;
  if (dto.config !== undefined) result.config = dto.config;
  if (dto.enabled_events !== undefined || dto.enabledEvents !== undefined)
    result.enabledEvents = dto.enabled_events ?? dto.enabledEvents;
  return result;
};

export const toLegacyNotificationDto = (setting: NotificationSetting) => ({
  id: setting.id,
  channel_type: setting.channelType,
  name: setting.name,
  enabled: setting.enabled,
  config: setting.config,
  enabled_events: setting.enabledEvents,
  created_at: setting.createdAt,
  updated_at: setting.updatedAt,
});
