import { Fingerprint, KeyRound, Server, ShieldCheck, SquareTerminal, Terminal, Wrench } from '@lucide/vue';
import type { Component } from 'vue';

const icons: ReadonlyMap<string, Component> = new Map([
	['fingerprint', Fingerprint],
	['key-round', KeyRound],
	['server', Server],
	['shield-check', ShieldCheck],
	['square-terminal', SquareTerminal],
	['terminal', Terminal],
	['wrench', Wrench],
]);

export function resolvePluginIcon(icon?: string): Component | undefined {
	return icon ? icons.get(icon) : undefined;
}
