export interface ApplicationEvent<TType extends string = string, TPayload = unknown> {
  type: TType;
  occurredAt: number;
  payload: TPayload;
}

export type ApplicationEventHandler<TEvent extends ApplicationEvent = ApplicationEvent> = (
  event: TEvent,
) => void | Promise<void>;

export interface ApplicationEventBus {
  publish(event: ApplicationEvent): Promise<void>;
  subscribe<TEvent extends ApplicationEvent>(
    type: TEvent['type'],
    handler: ApplicationEventHandler<TEvent>,
  ): () => void;
}
