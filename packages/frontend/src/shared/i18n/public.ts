/** Non-component consumers use the application-installed translator, never import the App owner. */
type UiTranslator = (key: string, parameters?: Record<string, string | number>) => string;

let translator: UiTranslator | undefined;

export function installUiTranslator(value: UiTranslator): void {
	translator = value;
}

export function translateUi(key: string, parameters?: Record<string, string | number>): string {
	if (!translator) {
		throw new Error('UI translator is not installed');
	}
	return translator(key, parameters);
}
