export interface NotificationMessage {
  event: string;
  details?: unknown;
}

export interface NotificationService {
  publish(message: NotificationMessage): Promise<void>;
}
