import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export interface InitializedEnvironment {
  dataDirectory: string;
}

const loadEnvFile = (filePath: string): void => {
  const result = dotenv.config({ path: filePath });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.warn(`[Environment] Unable to load ${filePath}: ${result.error.message}`);
  }
};

const findRootEnvPath = (): string => {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

const persistGeneratedSecrets = (dataEnvPath: string, entries: readonly [string, string][]): void => {
  if (entries.length === 0) return;
  fs.mkdirSync(path.dirname(dataEnvPath), { recursive: true, mode: 0o700 });
  const existing = fs.existsSync(dataEnvPath) ? fs.readFileSync(dataEnvPath, 'utf8') : '';
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const text = entries.map(([key, value]) => `${key}=${value}`).join('\n');
  fs.appendFileSync(dataEnvPath, `${prefix}${text}\n`, { mode: 0o600 });
  fs.chmodSync(dataEnvPath, 0o600);
};

export const initializeEnvironment = async (): Promise<InitializedEnvironment> => {
  loadEnvFile(findRootEnvPath());

  const dataDirectory = process.env.NEXUS_DATA_DIR
    ? path.resolve(process.env.NEXUS_DATA_DIR)
    : path.resolve(__dirname, '../../data');
  const dataEnvPath = path.join(dataDirectory, '.env');
  loadEnvFile(dataEnvPath);

  const generated: Array<[string, string]> = [];
  const ensureSecret = (name: string, byteLength: number): string => {
    const existing = process.env[name]?.trim();
    if (existing) return existing;
    const value = crypto.randomBytes(byteLength).toString('hex');
    process.env[name] = value;
    generated.push([name, value]);
    return value;
  };

  ensureSecret('ENCRYPTION_KEY', 32);
  ensureSecret('SESSION_SECRET', 64);
  ensureSecret('REMOTE_GATEWAY_SHARED_SECRET', 48);
  process.env.GUACD_HOST ||= 'localhost';
  process.env.GUACD_PORT ||= '4822';

  persistGeneratedSecrets(dataEnvPath, generated);
  if (generated.length > 0) {
    console.warn(`[Environment] Generated missing secrets and stored them in ${dataEnvPath}. Back up this file securely.`);
  }

  return { dataDirectory };
};
