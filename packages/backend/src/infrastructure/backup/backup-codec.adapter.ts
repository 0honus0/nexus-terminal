export interface BackupArchive {
  filename: string;
  bytes: Uint8Array;
}

/**
 * Technical backup file encoding boundary. Product selection/authentication is owned by Modules;
 * encryption/container-format details live here.
 */
export interface BackupCodecAdapter {
  encode(payload: unknown, password?: string): Promise<BackupArchive>;
  decode(bytes: Uint8Array, password?: string): Promise<unknown>;
}
