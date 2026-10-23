(() => {
	'use strict';

	const root = document.documentElement;
	const currentFile = window.location.pathname.split('/').pop() || 'dashboard.html';
	const routes = {
		dashboard: 'dashboard.html',
		terminal: 'terminal.html',
		connections: 'connections.html',
		proxies: 'proxies.html',
		notifications: 'notifications.html',
		audit: 'audit.html',
		settings: 'settings.html',
		login: 'login.html',
	};
	const hashRoutes = {
		'#dashboard': 'dashboard',
		'#workspace': 'terminal',
		'#terminal': 'terminal',
		'#connections': 'connections',
		'#proxies': 'proxies',
		'#notifications': 'notifications',
		'#audit': 'audit',
		'#settings': 'settings',
	};
	const labelRoutes = {
		仪表盘: 'dashboard',
		终端: 'terminal',
		连接管理: 'connections',
		代理管理: 'proxies',
		通知管理: 'notifications',
		审计日志: 'audit',
		设置: 'settings',
	};
	const pageRoutes = {
		'dashboard.html': 'dashboard',
		'navigation.html': 'dashboard',
		'terminal.html': 'terminal',
		'connections.html': 'connections',
		'proxies.html': 'proxies',
		'notifications.html': 'notifications',
		'audit.html': 'audit',
		'settings.html': 'settings',
	};

	const routeFromLink = (link) => {
		const explicit = link.dataset.nav || link.dataset.route;
		if (explicit) return explicit === 'workspace' ? 'terminal' : explicit;
		const hrefRoute = hashRoutes[link.getAttribute('href')];
		if (hrefRoute) return hrefRoute;
		const label = link.querySelector('span:last-child')?.textContent?.trim() || link.textContent.trim();
		return labelRoutes[label];
	};

	const assignRoute = (link, route) => {
		link.dataset.route = route;
		link.setAttribute('href', routes[route]);
	};

	const ensureMobileFooter = () => {
		const sheet = document.querySelector('.mobile-sheet');
		if (!sheet || sheet.querySelector('.mobile-sheet-footer')) return;

		const footer = document.createElement('div');
		footer.className = 'mobile-sheet-footer';
		footer.innerHTML = `
			<div class="mobile-session">
				<span class="avatar" aria-hidden="true">H</span>
				<span><strong>honus</strong><span>账户</span></span>
			</div>
			<button class="mobile-logout" type="button">
				<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M9 12h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				退出登录
			</button>`;
		sheet.append(footer);
	};

	ensureMobileFooter();

	const currentRoute = pageRoutes[currentFile] || 'dashboard';
	const navItems = [...document.querySelectorAll('.main-nav .nav-item, .mobile-sheet .nav-item')];

	for (const item of navItems) {
		const route = routeFromLink(item);
		if (!route || !routes[route]) continue;
		assignRoute(item, route);
		if (route === currentRoute) item.setAttribute('aria-current', 'page');
		else item.removeAttribute('aria-current');
	}

	for (const link of document.querySelectorAll('a[href]')) {
		const route = hashRoutes[link.getAttribute('href')];
		if (route) assignRoute(link, route);
	}

	const brand = document.querySelector('.brand');
	if (brand) brand.setAttribute('href', routes.dashboard);

	const normalizeAccountLabel = (container) => {
		const detail = container?.querySelector('strong + span');
		if (detail) detail.textContent = '账户';
	};

	document.querySelectorAll('.account-head, .mobile-session').forEach(normalizeAccountLabel);

	const tools = document.querySelector('.tools');
	if (tools && !tools.querySelector('.github-tool')) {
		const github = document.createElement('a');
		github.className = 'tool-button github-tool';
		github.href = 'https://github.com/0honus0/nexus-terminal';
		github.target = '_blank';
		github.rel = 'noopener noreferrer';
		github.title = '项目仓库';
		github.setAttribute('aria-label', '打开项目仓库');
		github.innerHTML =
			'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.5-1.2-3.5-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.2-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.2-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.5.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.4 4.7-4.6 4.9.4.3.7.9.7 1.8v2.6c0 .3.2.6.7.5A9.8 9.8 0 0 0 12 2.2Z"/></svg>';
		tools.insertBefore(github, tools.querySelector('.toolbar-line, .account-wrap, .mobile-trigger'));
	}

	const themeButton = document.querySelector('#theme-toggle');
	try {
		const savedTheme = localStorage.getItem('nexus-mock-theme');
		if (savedTheme === 'light' || savedTheme === 'dark') root.dataset.theme = savedTheme;
	} catch {
		// file:// environments can disable storage; theme still follows the page default.
	}
	if (themeButton) {
		themeButton.setAttribute('aria-label', root.dataset.theme === 'dark' ? '切换浅色主题' : '切换深色主题');
	}

	document.addEventListener(
		'click',
		(event) => {
			const themeToggle = event.target.closest('#theme-toggle');
			if (themeToggle) {
				window.setTimeout(() => {
					try {
						localStorage.setItem('nexus-mock-theme', root.dataset.theme);
					} catch {
						// Ignore storage failures in the design mockup.
					}
				}, 0);
				return;
			}

			const accountAction = event.target.closest('.account-menu .menu-link, .mobile-logout');
			if (accountAction) {
				const label = accountAction.textContent.trim();
				const target =
					label === '退出登录'
						? routes.login
						: label === '账户设置' || label === '外观与偏好'
							? routes.settings
							: null;
				if (target) {
					event.preventDefault();
					event.stopImmediatePropagation();
					window.location.assign(target);
				}
				return;
			}

			const routeLink = event.target.closest('a[data-route]');
			if (!routeLink || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
				return;
			event.preventDefault();
			event.stopImmediatePropagation();
			window.location.assign(routeLink.getAttribute('href'));
		},
		true,
	);
})();
