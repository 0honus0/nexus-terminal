import satisfies from 'semver/functions/satisfies.js';
import validRange from 'semver/ranges/valid.js';
import type { PluginEnvironment } from '../../plugin/plugin-api.node.js';
import type { PluginDistribution } from '../marketplace-catalog-types.js';

export function matchesDistribution(distribution: PluginDistribution, env: PluginEnvironment): boolean {
	const target = distribution.platform;
	return (
		!target ||
		(target.os === env.os &&
			target.arch === env.arch &&
			(!target.libc || target.libc === env.libc) &&
			(!target.abi || target.abi === env.abi) &&
			(!target.node || (!!validRange(target.node) && satisfies(env.node, target.node))))
	);
}

/** 优先最具体的兼容产物；同优先级多个匹配明确拒绝，目录顺序不决定安装内容。 */
export function selectDistribution(
	distributions: readonly PluginDistribution[],
	env: PluginEnvironment,
): {
	distribution?: PluginDistribution;
	code?: 'PLUGIN_ARTIFACT_UNAVAILABLE' | 'PLUGIN_ARTIFACT_AMBIGUOUS';
} {
	const score = (item: PluginDistribution) =>
		item.platform
			? 1 + Number(!!item.platform.libc) + Number(!!item.platform.abi) + Number(!!item.platform.node)
			: 0;

	const matches = distributions.filter((item) => matchesDistribution(item, env)).sort((a, b) => score(b) - score(a));
	if (!matches.length) return { code: 'PLUGIN_ARTIFACT_UNAVAILABLE' };
	if (matches.length > 1 && score(matches[0]) === score(matches[1])) return { code: 'PLUGIN_ARTIFACT_AMBIGUOUS' };
	return { distribution: matches[0] };
}
