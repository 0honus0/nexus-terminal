/** Quote each literal argv member for the real POSIX shell used by SSH fixtures. */
export function posixCommand(argv) {
	return argv.map((argument) => "'" + argument.replaceAll("'", "'\\''") + "'").join(' ');
}
