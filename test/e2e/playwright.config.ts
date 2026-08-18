import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const e2eRoot = __dirname;
const repoRoot = path.resolve(e2eRoot, "../..");
const testDataDir = path.join(e2eRoot, ".tmp", "backend-data");
const seedDbPath = path.join(
  e2eRoot,
  "fixtures",
  "seeded-data",
  "nexus-terminal.db",
);
const prepareTestDataScript = path.join(
  e2eRoot,
  "support",
  "prepare-test-data.mjs",
);

const backendEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  ),
  NODE_ENV: "test",
  PORT: "3001",
  NEXUS_DATA_DIR: testDataDir,
  NEXUS_E2E_RESET_ENABLED: "1",
  NEXUS_E2E_SEED_DB: seedDbPath,
  SESSION_COOKIE_NAME: "nexus.e2e.sid",
  SESSION_SECRET:
    "e2e-session-secret-do-not-use-outside-tests-000000000000000000000000",
  ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  REMOTE_GATEWAY_SHARED_SECRET:
    "e2e-remote-gateway-shared-secret-do-not-use-outside-tests",
};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 0,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [
        ["./support/mirrored-log-reporter.ts"],
        ["github"],
        ["html", { open: "never" }],
      ]
    : [
        ["./support/mirrored-log-reporter.ts"],
        ["list"],
        ["html", { open: "never" }],
      ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "auth",
      testMatch: /auth\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "http",
      testMatch: /http\/.*\.spec\.ts/,
    },
    {
      name: "websocket",
      testMatch: /websocket\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "ui",
      testMatch: /ui\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "ssh",
      testMatch: /ssh\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      testMatch: /mobile\/.*\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      command: "node support/test-ssh-server.mjs",
      cwd: e2eRoot,
      url: "http://127.0.0.1:22223/health",
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `node ${JSON.stringify(prepareTestDataScript)} && npm exec tsx -- src/index.ts`,
      cwd: path.join(repoRoot, "packages/backend"),
      env: backendEnv,
      url: "http://127.0.0.1:3001/api/v1/auth/needs-setup",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
      cwd: path.join(repoRoot, "packages/frontend"),
      env: {
        ...backendEnv,
        NEXUS_VITE_CACHE_DIR: path.join(e2eRoot, ".tmp", "vite-cache"),
      },
      url: "http://127.0.0.1:4173/login",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
