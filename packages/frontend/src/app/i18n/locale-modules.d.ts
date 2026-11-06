declare module 'virtual:nexus-locale/*' {
	interface MessageTree {
		[key: string]: string | MessageTree;
	}
	const messages: MessageTree;
	export default messages;
}
