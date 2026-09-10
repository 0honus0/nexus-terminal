export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface Scope {
  userId: number;
  appId: string;
}

export type Actor =
  | { kind: 'user'; userId: number }
  | {
      kind: 'agent';
      userId: number;
      appId: string;
      runId: string;
      agentRuntimeId: string;
    };

export interface PageRequest {
  limit: number;
  before?: string;
}

export interface ClockPort {
  nowUnixSeconds(): number;
}

export const systemClock: ClockPort = {
  nowUnixSeconds: () => Math.floor(Date.now() / 1000),
};
