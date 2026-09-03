import type { PasskeySummary } from '../../../modules/passkey/passkey.types';

/** Temporary response mapper for the current frontend passkey-management contract. */
export const toLegacyPasskeySummaryDto = (passkey: PasskeySummary) => ({
  credential_id: passkey.credentialId,
  created_at: passkey.createdAt,
  last_used_at: passkey.lastUsedAt,
  transports: passkey.transports,
  name: passkey.name,
});
