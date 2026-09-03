import axios from 'axios';
import nodemailer from 'nodemailer';
import type { NotificationChannelPort } from '../../modules/notifications/notification-channel.port';
import type {
  EmailConfig,
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationTestResult,
  PreparedNotification,
  TelegramConfig,
  WebhookConfig,
} from '../../modules/notifications/notification.types';

export class NetworkNotificationChannelAdapter implements NotificationChannelPort {
  async send(n: PreparedNotification): Promise<void> {
    if (n.channelType === 'email') return this.sendEmail(n.config as EmailConfig, n.subject ?? n.payload.event, n.body);
    if (n.channelType === 'telegram') return this.sendTelegram(n.config as TelegramConfig, n.body);
    return this.sendWebhook(n.config as WebhookConfig, n.body);
  }
  async test(type: NotificationChannelType, config: NotificationChannelConfig): Promise<NotificationTestResult> {
    try {
      const payload: PreparedNotification = {
        channelType: type,
        config,
        subject: 'Nexus Terminal Test Notification',
        body: 'This is a test notification from Nexus Terminal.',
        payload: { event: 'SETTINGS_UPDATED', timestamp: Date.now(), details: { test: true } },
      };
      await this.send(payload);
      return { success: true, message: '测试通知发送成功！' };
    } catch (error) {
      return { success: false, message: `测试通知发送失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  private async sendWebhook(c: WebhookConfig, body: string) {
    if (!c.url) throw new Error('Webhook URL is required.');
    await axios({
      method: c.method ?? 'POST',
      url: c.url,
      headers: { 'Content-Type': 'application/json', ...(c.headers ?? {}) },
      data: body,
      timeout: 10_000,
    });
  }
  private async sendEmail(c: EmailConfig, subject: string, body: string) {
    if (!c.to || !c.smtpHost || !c.smtpPort || !c.from) throw new Error('SMTP 配置缺少 to/host/port/from。');
    const transport = nodemailer.createTransport({
      host: c.smtpHost,
      port: c.smtpPort,
      secure: c.smtpSecure ?? true,
      auth: c.smtpUser || c.smtpPass ? { user: c.smtpUser, pass: c.smtpPass } : undefined,
    });
    await transport.sendMail({ from: c.from, to: c.to, subject, text: body });
  }
  private async sendTelegram(c: TelegramConfig, body: string) {
    if (!c.botToken || !c.chatId) throw new Error('Telegram 配置缺少 botToken/chatId。');
    let base = 'https://api.telegram.org';
    if (c.customDomain) {
      const u = new URL(c.customDomain);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('无效的 Telegram customDomain。');
      base = `${u.protocol}//${u.host}`;
    }
    const response = await axios.post(
      `${base}/bot${c.botToken}/sendMessage`,
      { chat_id: c.chatId, text: body, parse_mode: 'Markdown' },
      { timeout: 10_000 },
    );
    if (response.data?.ok === false) throw new Error(response.data?.description || 'Telegram API failed.');
  }
}
