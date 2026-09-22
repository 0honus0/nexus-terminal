import type {
  NotificationChannelTypeDto,
  NotificationConfigDto,
  NotificationEventDto,
  NotificationSettingCreateRequestDto,
  NotificationSettingDto,
} from '@nexus-terminal/protocol/notifications';

export type NotificationChannelType = NotificationChannelTypeDto;
export type NotificationEvent = NotificationEventDto;
export type NotificationConfig = NotificationConfigDto;
export type NotificationSetting = NotificationSettingDto;
export type NotificationSettingInput = NotificationSettingCreateRequestDto;
