export interface RuntimeConfig {
  host: string;
  port: number;
  nodeEnv: string;
}

const parsePort = (value: string | undefined): number => {
  if (!value) return 3001;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
};

export const loadRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): RuntimeConfig => ({
  host: env.HOST?.trim() || '0.0.0.0',
  port: parsePort(env.PORT),
  nodeEnv: env.NODE_ENV?.trim() || 'development',
});
