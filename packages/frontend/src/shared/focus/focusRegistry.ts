import { logger } from '@/client/logging/logger';

type FocusAction = () => boolean | void | Promise<boolean | void>;
interface FocusRegistration {
  action: FocusAction;
  available?: () => boolean;
}

const targets = new Map<string, FocusRegistration[]>();
let activeId: string | null = null;

export const focusRegistry = {
  register(id: string, action: FocusAction, available?: () => boolean): () => void {
    const registration: FocusRegistration = { action, ...(available ? { available } : {}) };
    const registrations = targets.get(id) ?? [];
    registrations.push(registration);
    targets.set(id, registrations);
    return () => {
      const current = targets.get(id);
      if (!current) return;
      const next = current.filter((item) => item !== registration);
      if (next.length) targets.set(id, next);
      else targets.delete(id);
      if (activeId === id && !next.length) activeId = null;
    };
  },

  async focus(id: string): Promise<boolean> {
    const registrations = targets.get(id);
    if (!registrations?.length) {
      logger.trace({ focusId: id }, 'Focus dispatch has no target');
      return false;
    }
    logger.trace({ focusId: id, targetCount: registrations.length }, 'Focus dispatch');
    for (let index = registrations.length - 1; index >= 0; index -= 1) {
      const registration = registrations[index]!;
      if (registration.available && !registration.available()) continue;
      const result = await registration.action();
      if (result === false) continue;
      activeId = id;
      return true;
    }
    return false;
  },

  async focusNext(sequence: readonly string[]): Promise<boolean> {
    if (!sequence.length) return false;
    const focusedElementId =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null)?.dataset.focusId : undefined;
    const currentId = focusedElementId && sequence.includes(focusedElementId) ? focusedElementId : activeId;
    const start = currentId ? sequence.indexOf(currentId) : -1;
    for (let offset = 1; offset <= sequence.length; offset += 1) {
      const id = sequence[(start + offset + sequence.length) % sequence.length]!;
      if (await this.focus(id)) return true;
    }
    return false;
  },
};
