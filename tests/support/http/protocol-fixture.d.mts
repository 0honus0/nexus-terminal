import type { APIRequestContext } from '@playwright/test';
import { test as baseTest } from 'vitest';
import type { openWorkspaceSession, openAuthenticatedWebSocket } from '../protocols/workspace-client';

export { expect } from 'vitest';

export type HttpClients = {
	primary: APIRequestContext;
	dataDirectory: string;
	createContext(): Promise<APIRequestContext>;
	url(path: string): URL;
	headers: { Host: string; Origin: string };
	openWorkspace(connectionId: number, workspaceId?: string): ReturnType<typeof openWorkspaceSession>;
	openSocket(path?: string): ReturnType<typeof openAuthenticatedWebSocket>;
};

export type HttpProtocolFixtures = {
	request: APIRequestContext;
	httpClients: HttpClients;
};

export const HTTP_TEST_ORIGIN: string;
export const HTTP_TEST_ADMIN: { username: string; password: string };
export const test: ReturnType<typeof baseTest.extend<HttpProtocolFixtures>>;
export function loginAsAdmin(request: APIRequestContext): Promise<void>;

export function useHttpProtocol(use: (clients: HttpClients) => Promise<void>,
	transport?: { origin: string; port: number; trustedProxies: string[] }): Promise<void>;
