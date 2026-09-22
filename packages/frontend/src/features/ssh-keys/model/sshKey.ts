import type { SshKeySummaryDto, SshKeyUpdateRequestDto } from '@nexus-terminal/protocol/connections';
export type { SshKeySummaryDto };

export type SshKeyFormInput = Omit<SshKeyUpdateRequestDto, 'name'> & {
  name: string;
};
