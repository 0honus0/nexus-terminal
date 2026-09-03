export interface SshKeySummary {
  id: number;
  name: string;
}
export interface SshKeyInput {
  name: string;
  privateKey: string;
  passphrase?: string | null;
}
export interface DecryptedSshKey extends SshKeySummary {
  privateKey: string;
  passphrase?: string;
}
