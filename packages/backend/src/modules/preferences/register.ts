import { registerPreferencesSnapshot } from './snapshots/adapters/sqlite/snapshot-registration.js';
import type { SnapshotRegistration } from '../../platform/storage/sqlite/snapshot-types.js';
import type { BoundedFetch } from '../../platform/network/bounded-fetch.js';
import { GithubHtmlThemeCatalog } from './appearance/adapters/github/html-theme-catalog.js';
import { createRemoteHtmlThemeRoutes } from './interfaces/http/remote-html-theme-http.js';
import { SqliteHtmlThemeStorage } from './appearance/adapters/sqlite/html-theme-sql.js';
import { HtmlThemeModel } from './appearance/model/html-theme-model.js';
import { HtmlThemeService } from './appearance/service/html-theme-service.js';
import { createHtmlThemeRoutes } from './interfaces/http/html-theme-http.js';
import type { ImageInspector } from '../../platform/images/image-inspector.js';
import { SqlitePresentationStorage } from './presentation/adapters/sqlite/presentation-sql.js';
import type { BlobStore } from '../../platform/blobs/blob-store.js';
import { SqliteBackgroundStorage } from './appearance/adapters/sqlite/background-sql.js';
import { BackgroundModel } from './appearance/model/background-model.js';
import { BackgroundService } from './appearance/service/background-service.js';
import { createBackgroundRoutes } from './interfaces/http/background-http.js';
import { SqliteAppearanceStorage } from './appearance/adapters/sqlite/appearance-sql.js';
import { AppearanceModel, fromStoredAppearance } from './appearance/model/appearance-model.js';
import { validateAppearance } from './appearance/appearance-rules.js';
import { AppearanceService } from './appearance/service/appearance-service.js';
import { createAppearanceRoutes } from './interfaces/http/appearance-http.js';
import { SqliteThemeStorage } from './themes/adapters/sqlite/theme-sql.js';
import { ThemeModel } from './themes/model/theme-model.js';
import { ThemeService } from './themes/service/theme-service.js';
import { createThemeRoutes } from './interfaces/http/theme-http.js';
import { PresentationModel } from './presentation/model/presentation-model.js';
import { PresentationService } from './presentation/service/presentation-service.js';
import { createPresentationRoutes } from './interfaces/http/presentation-http.js';
import { SqliteCommandStorage } from './commands/adapters/sqlite/command-sql.js';
import { CommandModel } from './commands/model/command-model.js';
import { CommandService } from './commands/service/command-service.js';
import { createCommandRoutes } from './interfaces/http/command-http.js';
import { SqliteFavoriteStorage } from './favorites/adapters/sqlite/favorite-sql.js';
import { FavoriteModel } from './favorites/model/favorite-model.js';
import { FavoriteService } from './favorites/service/favorite-service.js';
import { createFavoriteRoutes } from './interfaces/http/favorite-http.js';
import { SqliteHistoryStorage } from './history/adapters/sqlite/history-sql.js';
import { HistoryModel } from './history/model/history-model.js';
import { HistoryService } from './history/service/history-service.js';
import { createHistoryRoutes } from './interfaces/http/history-http.js';
import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { SecureSessionTokens } from '../../platform/security/adapters/secure-session-tokens.js';
import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';
import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../../platform/security/secret-box.js';
import type { PreferencesInstallation } from './public.js';
import type { HttpRoute } from '../../platform/http/http-types.js';
import type { AccessPublicApi } from '../access/public.js';
import { NativeSourceAddresses } from '../../platform/security/adapters/source-addresses.js';
import { validateConfiguration } from './configuration/configuration-rules.js';
import { ConfigurationModel, fromStoredConfiguration } from './configuration/model/configuration-model.js';
import { ConfigurationService } from './configuration/service/configuration-service.js';
import { SqliteConfigurationStorage } from './configuration/adapters/sqlite/configuration-sql.js';
import { createConfigurationRoutes } from './interfaces/http/configuration-http.js';

export interface PreferencesSeed {
	ipWhitelist: string;
	ipBlacklistEnabled: boolean;
	maxLoginAttempts: number;
	loginBanDuration: number;
	statusMonitorIntervalSeconds: number;
	remoteHostRefreshIntervalSeconds: number;
	passkeys: Array<{ origin: string; rpId: string }>;
	captcha: {
		enabled: boolean;
		provider: AccessCaptchaProvider;
		siteKey: string;
		secretKey: string;
		expectedHostname: string | null;
	};
}

export interface PreferencesRegistrationOptions {
	backgrounds: BlobStore;
	network: BoundedFetch;
	githubToken: string | null;
	imageInspector: ImageInspector;
	sqlite: SqliteRuntime;
	secrets: SecretBox | null;
	seed?: () => PreferencesSeed;
}

export interface RegisteredPreferences {
	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void;
	installation: PreferencesInstallation;
	routes(access: AccessPublicApi): HttpRoute[];
	quiesce(): void;
	close(): Promise<void>;
}

export async function registerPreferences(options: PreferencesRegistrationOptions): Promise<RegisteredPreferences> {
	const storage = new SqliteConfigurationStorage(options.sqlite);
	const historyStorage = new SqliteHistoryStorage(options.sqlite);
	const presentationStorage = new SqlitePresentationStorage(options.sqlite);
	const presentation = new PresentationService(new PresentationModel(presentationStorage, new SecureSessionTokens()));
	const commandStorage = new SqliteCommandStorage(options.sqlite);
	const commands = new CommandService(new CommandModel(commandStorage, new SecureSessionTokens()));
	const favoriteStorage = new SqliteFavoriteStorage(options.sqlite);
	const themeStorage = new SqliteThemeStorage(options.sqlite);
	const backgroundStorage = new SqliteBackgroundStorage(options.sqlite);
	const backgrounds = new BackgroundService(
		new BackgroundModel(backgroundStorage, options.backgrounds, new SecureSessionTokens(), options.imageInspector),
	);
	await backgrounds.initialize();
	const htmlThemeStorage = new SqliteHtmlThemeStorage(options.sqlite);

	const appearanceStorage = new SqliteAppearanceStorage(options.sqlite);
	const appearance = new AppearanceService(new AppearanceModel(appearanceStorage, new SecureSessionTokens()));
	const htmlThemes = new HtmlThemeService(
		new HtmlThemeModel(
			htmlThemeStorage,
			new SecureSessionTokens(),
			new GithubHtmlThemeCatalog(options.network, options.githubToken),
		),
		appearance,
	);
	const themes = new ThemeService(new ThemeModel(themeStorage, new SecureSessionTokens()));
	await themes.initialize();
	const favorites = new FavoriteService(new FavoriteModel(favoriteStorage, new SecureSessionTokens()));
	const history = new HistoryService(new HistoryModel(historyStorage, new SecureSessionTokens()));
	const service = new ConfigurationService(
		new ConfigurationModel(storage, options.secrets, new NativeSourceAddresses(), new SecureSessionTokens()),
	);
	const loadSeed = options.seed;
	const installed = await service.initialize(
		loadSeed
			? () => {
					const seed = loadSeed();
					return {
						policy: {
							ipWhitelist: seed.ipWhitelist,
							ipBlacklistEnabled: seed.ipBlacklistEnabled,
							maxLoginAttempts: seed.maxLoginAttempts,
							loginBanDuration: seed.loginBanDuration,
							statusMonitorIntervalSeconds: seed.statusMonitorIntervalSeconds,
							remoteHostRefreshIntervalSeconds: seed.remoteHostRefreshIntervalSeconds,
							passkeys: seed.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
						},
						captcha: {
							enabled: seed.captcha.enabled,
							provider: seed.captcha.provider,
							siteKey: seed.captcha.siteKey,
							secretKey: seed.captcha.secretKey,
							expectedHostname: seed.captcha.expectedHostname,
						},
					};
				}
			: undefined,
	);
	let closePromise: Promise<void> | null = null;
	return {
		installTransactionIdentityReader: (read) => {
			storage.installTransactionIdentityReader(read);
			historyStorage.installTransactionIdentityReader(read);
			presentationStorage.installTransactionIdentityReader(read);
			commandStorage.installTransactionIdentityReader(read);
			favoriteStorage.installTransactionIdentityReader(read);
			themeStorage.installTransactionIdentityReader(read);
			appearanceStorage.installTransactionIdentityReader(read);
			backgroundStorage.installTransactionIdentityReader(read);
			htmlThemeStorage.installTransactionIdentityReader(read);
		},

		installation: {
			version: installed.version,
			ipWhitelist: installed.policy.ipWhitelist,
			ipBlacklistEnabled: installed.policy.ipBlacklistEnabled,
			maxLoginAttempts: installed.policy.maxLoginAttempts,
			loginBanDuration: installed.policy.loginBanDuration,
			statusMonitorIntervalSeconds: installed.policy.statusMonitorIntervalSeconds,
			remoteHostRefreshIntervalSeconds: installed.policy.remoteHostRefreshIntervalSeconds,
			passkeys: installed.policy.passkeys.map((site) => ({ origin: site.origin, rpId: site.rpId })),
			captcha: {
				enabled: installed.captcha.enabled,
				provider: installed.captcha.provider,
				siteKey: installed.captcha.siteKey,
				secretKey: installed.captcha.secretKey,
				expectedHostname: installed.captcha.expectedHostname,
			},
		},

		routes: (access) => [
			...createConfigurationRoutes(service, access),
			...createHistoryRoutes(history, access),
			...createFavoriteRoutes(favorites, access),
			...createCommandRoutes(commands, access),
			...createPresentationRoutes(presentation, access),
			...createThemeRoutes(themes, access),
			...createAppearanceRoutes(appearance, access),
			...createHtmlThemeRoutes(htmlThemes, access),
			...createRemoteHtmlThemeRoutes(htmlThemes, access),
			...createBackgroundRoutes(backgrounds, access),
		],

		quiesce: () => {
			service.quiesce();
			history.quiesce();
			presentation.quiesce();
			commands.quiesce();
			favorites.quiesce();
			themes.quiesce();
			appearance.quiesce();
			backgrounds.quiesce();
			htmlThemes.quiesce();
		},

		close: () => {
			if (!closePromise) {
				const owners = [
					service,
					history,
					favorites,
					commands,
					presentation,
					themes,
					appearance,
					backgrounds,
					htmlThemes,
				];
				const failures: unknown[] = [];
				closePromise = Promise.resolve().then(async () => {
					const results = await Promise.allSettled(
						owners.map((owner) => Promise.resolve().then(() => owner.close())),
					);
					for (const result of results) {
						if (result.status === 'rejected') {
							failures.push(result.reason);
						}
					}
					if (failures.length) {
						throw new AggregateError(failures, 'Preferences shutdown failed');
					}
				});
				for (const owner of owners) {
					try {
						owner.quiesce();
					} catch (error) {
						failures.push(error);
					}
				}
			}
			return closePromise;
		},
	};
}

/** Installation-only fixed storage coverage; no business records leave the adapter. */
export function registerPreferencesBackup(secrets: SecretBox | null): SnapshotRegistration {
	const addresses = new NativeSourceAddresses();
	return registerPreferencesSnapshot(
		secrets,
		(value) => validateAppearance(fromStoredAppearance(value)),
		(value) =>
			validateConfiguration(fromStoredConfiguration(value, secrets), (network) => {
				addresses.parseNetwork(network);
			}),
	);
}
