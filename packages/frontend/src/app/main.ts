import { logger } from '@/client/logging/logger';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { setUnauthorizedHandler } from '@/client/http';
import { setNetworkFailureHandler } from '@/client/http/network-failure';
import { useFeedback } from '@/shared/feedback/public';
import { createAuthNavigationFacade } from '@/features/auth/public';
import { createAppRouter } from './router';
import i18n from './i18n';
import { registerAppServiceWorker, registerGlobalDynamicImportRecovery } from './bootstrap/pwa';
import { registerGlobalRuntimeDiagnostics, registerVueRuntimeDiagnostics } from './bootstrap/runtimeDiagnostics';
import './styles/global.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

registerGlobalRuntimeDiagnostics();
registerGlobalDynamicImportRecovery();

const app = createApp(App);
registerVueRuntimeDiagnostics(app);
const pinia = createPinia();
const router = createAppRouter(pinia);
const auth = createAuthNavigationFacade(pinia);

setUnauthorizedHandler(async () => {
	if (!auth.authenticated) return;
	auth.invalidateSession();
	if (router.currentRoute.value.name !== 'Login') await router.replace({ name: 'Login' });
});

app.use(pinia);
const feedback = useFeedback();
setNetworkFailureHandler(() => feedback.notifyError(i18n.global.t('feedback.networkUnavailable'), 0));
app.use(i18n);
app.use(router);
app.mount('#app');
logger.info({ pathname: window.location.pathname }, 'Frontend application mounted');
registerAppServiceWorker();
