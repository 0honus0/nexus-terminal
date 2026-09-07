import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { setUnauthorizedHandler } from '@/client/http';
import { createAuthNavigationFacade } from '@/features/auth/public';
import { createAppRouter } from './router';
import i18n from './i18n';
import { registerAppServiceWorker } from './bootstrap/pwa';
import './styles/global.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

const app = createApp(App);
const pinia = createPinia();
const router = createAppRouter(pinia);
const auth = createAuthNavigationFacade(pinia);

setUnauthorizedHandler(async () => {
  if (!auth.authenticated) return;
  auth.invalidateSession();
  if (router.currentRoute.value.name !== 'Login') await router.replace({ name: 'Login' });
});

app.use(pinia);
app.use(i18n);
app.use(router);
app.mount('#app');
registerAppServiceWorker();
