import { test } from '@playwright/test';

export const DEFAULT_STEP_TIMEOUT = 30_000;
export const SLOW_STEP_TIMEOUT = 60_000;

export function step<T>(
  title: string,
  body: () => Promise<T>,
  timeout = DEFAULT_STEP_TIMEOUT,
): Promise<T> {
  return test.step(title, body, { timeout });
}

export function slowStep<T>(title: string, body: () => Promise<T>): Promise<T> {
  return step(title, body, SLOW_STEP_TIMEOUT);
}
