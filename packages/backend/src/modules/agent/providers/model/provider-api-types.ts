import type {
	ProviderInput,
	ProviderPatch,
	ProviderView,
	DiscoveredModel,
	ProviderTestResult,
	AvailableModel,
} from './provider-types.js';
import type { RegistryResolution, RegistryStatus } from '../registry/model/registry-types.js';

export interface AgentProviderApi {
	registryStatus(userId: number): Promise<RegistryStatus>;
	registryResolve(userId: number, modelId: string): Promise<RegistryResolution>;
	registryRefresh(userId: number, signal?: AbortSignal): Promise<RegistryStatus>;
	list(userId: number): Promise<ProviderView[]>;
	get(userId: number, id: string): Promise<ProviderView>;
	create(userId: number, input: ProviderInput): Promise<ProviderView>;
	update(userId: number, id: string, expectedVersion: number, input: ProviderPatch): Promise<ProviderView>;
	remove(userId: number, id: string, expectedVersion: number): Promise<void>;
	available(userId: number): Promise<AvailableModel[]>;
	discover(
		userId: number,
		id: string,
		authorizeBeforeWrite: () => Promise<void>,
		signal?: AbortSignal,
	): Promise<DiscoveredModel[]>;
	discoverEndpoint(
		userId: number,
		baseUrl: string,
		credential?: string,
		signal?: AbortSignal,
	): Promise<DiscoveredModel[]>;
	test(userId: number, id: string, modelId: string, signal?: AbortSignal): Promise<ProviderTestResult>;
}
