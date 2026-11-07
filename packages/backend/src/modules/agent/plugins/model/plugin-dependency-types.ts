/** Package delivery edges, independent of live service calls and their direction. */
export interface PluginCodeDependencyNode {
	id: string;
	dependencies: readonly string[];
}
