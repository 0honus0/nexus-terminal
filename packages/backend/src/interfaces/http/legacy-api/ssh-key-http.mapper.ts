import type { SshKeyInput } from '../../../modules/ssh-keys/ssh-key.types';

export interface LegacySshKeyWriteDto {
  name?: string;
  private_key?: string;
  privateKey?: string;
  passphrase?: string | null;
}

export const fromLegacySshKeyCreateDto = (dto: LegacySshKeyWriteDto): SshKeyInput => ({
  name: dto.name ?? '',
  privateKey: dto.private_key ?? dto.privateKey ?? '',
  passphrase: dto.passphrase,
});

export const fromLegacySshKeyUpdateDto = (dto: LegacySshKeyWriteDto): Partial<SshKeyInput> => {
  const result: Partial<SshKeyInput> = {};
  if (dto.name !== undefined) result.name = dto.name;
  if (dto.private_key !== undefined || dto.privateKey !== undefined)
    result.privateKey = dto.private_key ?? dto.privateKey ?? '';
  if (dto.passphrase !== undefined) result.passphrase = dto.passphrase;
  return result;
};
