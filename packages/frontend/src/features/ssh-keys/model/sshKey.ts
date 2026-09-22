import type { SshKeySummaryDto } from '@nexus-terminal/protocol/connections';

export type SshKeySummary = SshKeySummaryDto;

export interface SshKeyInput {
  name: string;
  privateKey?: string;
  passphrase?: string | null;
}
