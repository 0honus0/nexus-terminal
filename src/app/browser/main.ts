import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import { authMessages } from '../../auth/browser/auth-api.js';
import { App } from './app.js';
import { appMessages } from './app-messages.js';
import AppView from './App.vue';
import './app.css';

const app = new App();
const locale =
	navigator.languages
		.map((language) => language.split('-')[0])
		.find((language) => Object.hasOwn(appMessages, language)) ?? 'en';
const i18n = createI18n({
	legacy: false,
	locale,
	fallbackLocale: 'en',
	messages: {
		en: {
			...appMessages.en,
			...authMessages.en,
			notices: { ...authMessages.en.notices, ...appMessages.en.notices },
		},
		zh: {
			...appMessages.zh,
			...authMessages.zh,
			notices: { ...authMessages.zh.notices, ...appMessages.zh.notices },
		},
	},
});
const vue = createApp(AppView, {
	contributions: app.contributions,
	log: app.log,
	auth: app.auth,
	windowLauncher: app.windows,

	getState: () => app.state,

	preparePlugins: () => app.preparePlugins(),
});

vue.use(i18n);
vue.onUnmount(() => {
	void app.close().catch(() => app.log.report({ source: 'app', level: 'error', code: 'APP_CLOSE_FAILED' }));
});
vue.mount('#app');
import.meta.hot?.dispose(() => vue.unmount());

void app.start().catch((cause) => app.auth.reportFailure(cause));
