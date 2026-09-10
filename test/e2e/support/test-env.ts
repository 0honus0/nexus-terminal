const parsePort = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return value;
};

export const E2E_PORTS = {
  backend: parsePort('NEXUS_E2E_BACKEND_PORT', 3001),
  frontend: parsePort('NEXUS_E2E_FRONTEND_PORT', 4173),
  guacd: parsePort('NEXUS_E2E_GUACD_PORT', 24822),
  guacdControl: parsePort('NEXUS_E2E_GUACD_CONTROL_PORT', 29090),
  ssh: parsePort('NEXUS_E2E_SSH_PORT', 22222),
  sshControl: parsePort('NEXUS_E2E_SSH_CONTROL_PORT', 22223),
  smtp: parsePort('NEXUS_E2E_SMTP_PORT', 22224),
} as const;

export const E2E_URLS = {
  backendOrigin: `http://127.0.0.1:${E2E_PORTS.backend}`,
  backendWsOrigin: `ws://127.0.0.1:${E2E_PORTS.backend}`,
  frontendOrigin: `http://localhost:${E2E_PORTS.frontend}`,
  frontendLoopbackOrigin: `http://127.0.0.1:${E2E_PORTS.frontend}`,
  frontendWsOrigin: `ws://127.0.0.1:${E2E_PORTS.frontend}`,
  guacdControlOrigin: `http://127.0.0.1:${E2E_PORTS.guacdControl}`,
  sshControlOrigin: `http://127.0.0.1:${E2E_PORTS.sshControl}`,
} as const;
