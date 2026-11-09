export class StartupConfigurationFailure extends Error {
	constructor(readonly setting: string) {
		super('Invalid backend entry configuration');
	}
}
