import { computed, type ComputedRef } from 'vue';
import type { SshKeyFormInput, SshKeySummaryDto } from '../model/sshKey';
import { useSshKeysStore } from '../store/sshKeys.store';

export interface SshKeysController {
  keys: ComputedRef<SshKeySummaryDto[]>;
  load(force?: boolean): Promise<SshKeySummaryDto[]>;
  create(input: SshKeyFormInput): Promise<SshKeySummaryDto>;
  update(id: number, input: SshKeyFormInput): Promise<SshKeySummaryDto>;
  remove(id: number): Promise<void>;
}

export function useSshKeys(): SshKeysController {
  const store = useSshKeysStore();
  return {
    keys: computed(() => store.items),
    load: store.load.bind(store),
    create: store.create.bind(store),
    update: store.update.bind(store),
    remove: store.remove.bind(store),
  };
}
