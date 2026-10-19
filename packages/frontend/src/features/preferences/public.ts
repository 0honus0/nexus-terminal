export const loadPreferencesSettingsPanel = () => import('./components/PreferencesSettingsPanel.vue');

export const loadWorkspacePreferencesPanel = () => import('./components/WorkspacePreferencesPanel.vue');

export { resetPreferencesCache, usePreferences } from './composables/usePreferences';

export type {
	PreferencesController,
	UserPresentation,
	PersonalLayout,
	PersonalFocus,
	PersonalSidebar,
	PresentationChange,
} from './model/preferences-types';

export { usePresentationStore } from './store/presentation.store';

export type { UserPreferences, PreferenceKey, PreferencesPatch } from './model/preferences-types';

export { commonTimezones, preferenceLanguageNames, terminalScrollbackForRuntime } from './model/preferences-types';

export { configurationApi } from './api/configuration-api';

export { ConfigurationFailure } from './model/configuration-types';

export type { CoreConfiguration, NetworkPolicy, CaptchaDraft } from './model/configuration-types';

export { useMonitoringConfiguration } from './composables/use-monitoring-configuration';

export type { MonitoringIntervals, MonitoringConfigurationController } from './model/configuration-types';
