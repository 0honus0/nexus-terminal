import { OpenAiProviderAdapter } from '../../infrastructure/agent/providers/openai-provider.adapter';
import {
	LocalModelCapabilityRegistryStore,
	ModelsDevCapabilityRegistrySource,
} from '../../infrastructure/agent/providers/model-capability-registry.adapter';
import { ProviderSecretAdapter } from '../../infrastructure/agent/providers/provider-secret.adapter';
import { SqliteProviderRepository } from '../../infrastructure/agent/repositories/sqlite-provider.repository';
import { ProviderService } from '../../modules/agent/ai/provider.service';
import { ModelCapabilityRegistryService } from '../../modules/agent/ai/model-capability-registry.service';
import { systemClock } from '../../modules/agent/agent.types';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../shared/security/crypto.port';

interface ComposeProvidersOptions {
	database: RelationalDatabase;
	cipher: SecretCipher;
	dataDirectory: string;
	refreshHealth: (userId: number) => Promise<void>;
}

/** Construction only; initialization and disposal remain in the Agent composition root. */
export const composeProviders = ({ database, cipher, dataDirectory, refreshHealth }: ComposeProvidersOptions) => {
	const providerRepository = new SqliteProviderRepository(database, cipher);
	const modelRegistry = new ModelCapabilityRegistryService(
		new LocalModelCapabilityRegistryStore(dataDirectory),
		new ModelsDevCapabilityRegistrySource(),
		systemClock,
	);
	const providerSecrets = new ProviderSecretAdapter(database, cipher);
	let providers: ProviderService;
	const languageModel = new OpenAiProviderAdapter(
		{ get: (userId, providerId) => providers.get(userId, providerId) },
		providerSecrets,
	);
	providers = new ProviderService(providerRepository, languageModel, systemClock, refreshHealth);
	return { providers, languageModel, modelRegistry };
};
