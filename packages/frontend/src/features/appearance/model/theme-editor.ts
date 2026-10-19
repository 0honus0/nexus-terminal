export function formatThemeObject(theme: Record<string, string>): string {
	return JSON.stringify(theme, null, 2);
}
