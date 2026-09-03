import { EventEmitter } from 'node:events';
import type {
  ApplicationEvent,
  ApplicationEventBus,
  ApplicationEventHandler,
} from '../../shared/events/application-event';

export class NodeApplicationEventBus implements ApplicationEventBus {
  private readonly emitter = new EventEmitter();

  constructor(maxListeners = 50) {
    this.emitter.setMaxListeners(maxListeners);
  }

  async publish(event: ApplicationEvent): Promise<void> {
    const handlers = this.emitter.listeners(event.type) as Array<ApplicationEventHandler>;
    await Promise.all(handlers.map((handler) => Promise.resolve(handler(event))));
  }

  subscribe<TEvent extends ApplicationEvent>(
    type: TEvent['type'],
    handler: ApplicationEventHandler<TEvent>,
  ): () => void {
    const listener = (event: ApplicationEvent) => handler(event as TEvent);
    this.emitter.on(type, listener);
    return () => this.emitter.off(type, listener);
  }
}
