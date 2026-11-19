import { z } from 'zod';

export const PluginServiceReferenceSchema = z.tuple([z.string().min(1), z.string().min(1)]).readonly();

export type PluginServiceReference = z.infer<typeof PluginServiceReferenceSchema>;

export const PluginServiceSelectionSchema = z.record(z.string().min(1), PluginServiceReferenceSchema).readonly();

export type PluginServiceSelection = z.infer<typeof PluginServiceSelectionSchema>;

type Provider<Services> = Extract<keyof Services, string>;

type ServiceName<Services, Owner extends Provider<Services>> = Extract<keyof Services[Owner], string>;

export type DeclaredServiceReference<Services> = {
	[Owner in Provider<Services>]: {
		[Name in ServiceName<Services, Owner>]: readonly [Owner, Name];
	}[ServiceName<Services, Owner>];
}[Provider<Services>];

export type ServiceRegistration<Services> = {
	[Owner in Provider<Services>]: {
		[Name in ServiceName<Services, Owner>]: [name: Name, service: Services[Owner][Name]];
	}[ServiceName<Services, Owner>];
}[Provider<Services>];

export type SelectedServices<Services, Selection extends PluginServiceSelection> = {
	readonly [Alias in keyof Selection]: Selection[Alias] extends readonly [infer Owner, infer Name]
		? Owner extends Provider<Services>
			? Name extends ServiceName<Services, Owner>
				? Services[Owner][Name]
				: never
			: never
		: never;
};
