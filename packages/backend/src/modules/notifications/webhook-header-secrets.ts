import type { WebhookConfig } from './notification.types';

export const isSecretWebhookHeader = (name: string, config: WebhookConfig): boolean =>
  /^(authorization|proxy-authorization|cookie|set-cookie|.*(?:api[-_]?key|token|secret).*)$/i.test(name) ||
  !!config.secretHeaderNames?.some((entry) => entry.toLowerCase() === name.toLowerCase());
