import { createHash } from 'node:crypto';

/** Canonical SSH identity shared by live inspection and durable mutation authorization. */
export const sshTargetIdentity = (endpoint: string, loginUser: string, configurationHash: string): string =>
  createHash('sha256').update(`${endpoint}\n${loginUser}\n${configurationHash}`, 'utf8').digest('hex');
