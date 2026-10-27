import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue';
import type { SettingsReloadSource } from '../model';
import { useSettingsReloadStore } from '../store/settings-reload.store';

/** Registers one mounted settings owner and removes it while the owner is inactive. */
export function useSettingsReloadSource(source: SettingsReloadSource): void {
	const store = useSettingsReloadStore();
	let unregister: (() => void) | undefined;

	const register = (): void => {
		if (unregister) return;
		unregister = store.register(source);
	};

	const remove = (): void => {
		unregister?.();
		unregister = undefined;
	};

	onMounted(register);
	onActivated(register);
	onDeactivated(remove);
	onBeforeUnmount(remove);
}
