import { isRef, shallowReadonly, shallowRef, type ShallowRef } from 'vue';
import { z } from 'zod';
import type { AuthLoginContribution } from '../../auth/browser/auth-plugin-api.js';
import type { UiTheme } from '../../ui/browser/ui-theme-types.js';
import { CodedError } from '../../utils/error.js';
import type { PluginContextApi } from '../plugin-api.browser.js';
import type { PluginScopeApi } from '../plugin-api.js';
import type {
	PluginApplicationTileContribution,
	PluginComponentContribution,
	PluginContributions,
} from './plugin-contribution-api.js';

type ContributionKind = keyof PluginContributions;

type ComponentContribution = PluginComponentContribution &
	Pick<
		z.infer<typeof ApplicationSchema>,
		'multipleWindows' | 'defaultWindowSize' | 'scrollMode' | 'scrollbarGutter' | 'tile'
	> & { readonly kind: 'applications' | 'widgets' };

type LoginContribution = AuthLoginContribution & { readonly kind: 'login' };

type ThemeContribution = UiTheme & { readonly kind: 'themes' };

type Contribution = ComponentContribution | LoginContribution | ThemeContribution;

const labelFields = {
	id: z
		.string()
		.max(128)
		.regex(/^[a-zA-Z0-9][\w.-]*$/u),
	label: z.custom<PluginComponentContribution['label']>(
		(value) => typeof value === 'string' || typeof value === 'function' || isRef(value),
	),
};

const ComponentSchema = z.strictObject({
	...labelFields,
	component: z.custom<PluginComponentContribution['component']>(
		(value) => typeof value === 'function' || (value !== null && typeof value === 'object'),
	),
});

const ApplicationSchema = ComponentSchema.extend({
	tile: z
		.strictObject({
			component: z.custom<PluginApplicationTileContribution['component']>(
				(value) => typeof value === 'function' || (value !== null && typeof value === 'object'),
			),
			showAtIconSize: z.boolean().optional(),
		})
		.optional(),
	multipleWindows: z.boolean().optional(),
	defaultWindowSize: z.strictObject({ width: z.number().positive(), height: z.number().positive() }).optional(),
	scrollMode: z.enum(['content', 'window']).optional(),
	scrollbarGutter: z.enum(['auto', 'stable']).optional(),
});

const LoginSchema = z.strictObject({
	...labelFields,
	icon: ComponentSchema.shape.component.optional(),
	start: z.custom<AuthLoginContribution['start']>((value) => typeof value === 'function'),
});

const ThemeSchema = z.strictObject({
	...labelFields,
	mode: z.enum(['light', 'dark']),
	tokens: z.record(z.string().startsWith('--ui-'), z.string()).readonly(),
});

const ContributionsSchema = z.strictObject({
	applications: z.array(ApplicationSchema).optional(),
	widgets: z.array(ComponentSchema).optional(),
	login: z.array(LoginSchema).optional(),
	themes: z.array(ThemeSchema).optional(),
} satisfies Record<ContributionKind, z.ZodType>);

interface ContributionOwner {
	readonly key: string;
	readonly instance: symbol;
	readonly context: PluginContextApi;
	readonly lifetime: PluginScopeApi;
}

export type PluginComponentEntry = ContributionOwner & ComponentContribution;

export type PluginLoginEntry = ContributionOwner & LoginContribution;

export type PluginThemeEntry = ContributionOwner & ThemeContribution;

export type PluginContributionEntry = PluginComponentEntry | PluginLoginEntry | PluginThemeEntry;

export type PluginContributionList = Readonly<ShallowRef<readonly PluginContributionEntry[]>>;

/** 激活期间收集声明，校验整批后再写入，失败时可直接丢弃本次声明。 */
export class PluginContributionBatch {
	readonly #entries = new Map<string, Contribution>();
	readonly #instance = Symbol();

	add(input: PluginContributions, signal: AbortSignal): void {
		signal.throwIfAborted();
		const parsed = ContributionsSchema.safeParse(input);
		if (!parsed.success) throw new CodedError('PLUGIN_CONTRIBUTIONS_INVALID', { cause: parsed.error });
		// 声明中的 getter 可能运行插件代码。校验结束后仍要确认本次激活有效。
		signal.throwIfAborted();
		const next = new Map<string, Contribution>();
		for (const kind of Object.keys(parsed.data) as ContributionKind[]) {
			for (const declaration of parsed.data[kind] ?? []) {
				const key = `${kind}:${declaration.id}`;
				if (this.#entries.has(key) || next.has(key)) throw new CodedError('PLUGIN_CONTRIBUTION_DUPLICATE');
				// kind 同时索引校验结果与贡献类型。
				next.set(key, Object.freeze({ ...declaration, kind }) as Contribution);
			}
		}
		for (const [key, contribution] of next) this.#entries.set(key, contribution);
	}

	entries(context: PluginContextApi, lifetime: PluginScopeApi): readonly PluginContributionEntry[] {
		return [...this.#entries].map(([key, entry]) =>
			Object.freeze({ ...entry, key: `${context.self.id}:${key}`, instance: this.#instance, context, lifetime }),
		);
	}
}

/** 宿主消费响应式列表，组件定义保持为原始 Vue 对象。 */
export class PluginContributionRegistry {
	readonly #entries = shallowRef<readonly PluginContributionEntry[]>([]);
	readonly entries: PluginContributionList = shallowReadonly(this.#entries);

	publish(batch: PluginContributionBatch, context: PluginContextApi, lifetime: PluginScopeApi): void {
		lifetime.signal.throwIfAborted();
		const entries = batch.entries(context, lifetime);
		if (!entries.length) return;

		lifetime.signal.addEventListener(
			'abort',
			() => {
				this.#entries.value = Object.freeze(this.#entries.value.filter((entry) => entry.lifetime !== lifetime));
			},
			{ once: true },
		);
		this.#entries.value = Object.freeze([...this.#entries.value, ...entries]);
	}
}
