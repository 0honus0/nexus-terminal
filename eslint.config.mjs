import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

const unusedRule = [
	'error',
	{
		argsIgnorePattern: '^_',
		caughtErrorsIgnorePattern: '^_',
		varsIgnorePattern: '^_',
	},
];

const functionSpacingPlugin = {
	rules: {
		'function-spacing': {
			meta: {
				type: 'layout',
				docs: { description: 'require a blank line around functions, methods and export declarations' },
				fixable: 'whitespace',
				schema: [],
				messages: { needsSpacing: 'Add a blank line around this function, method or export declaration.' },
			},

			create(context) {
				const sourceCode = context.sourceCode;
				const lineEnding = sourceCode.text.includes('\r\n') ? '\r\n' : '\n';

				const isFunctionExpression = (node) => {
					let current = node;
					while (
						current &&
						[
							'TSAsExpression',
							'TSSatisfiesExpression',
							'TSNonNullExpression',
							'TypeCastExpression',
						].includes(current.type)
					) {
						current = current.expression;
					}
					return current?.type === 'ArrowFunctionExpression' || current?.type === 'FunctionExpression';
				};

				const isFunctionLike = (node) => {
					if (!node) return false;

					if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
						return isFunctionLike(node.declaration);
					}

					if (
						node.type === 'FunctionDeclaration' ||
						node.type === 'MethodDefinition' ||
						node.type === 'TSDeclareMethod'
					)
						return true;

					if (node.type === 'VariableDeclaration' && node.declarations.length === 1)
						return isFunctionExpression(node.declarations[0].init);

					if (node.type === 'PropertyDefinition') return isFunctionExpression(node.value);

					if (node.type === 'Property') return node.method || isFunctionExpression(node.value);

					return false;
				};

				const isExport = (node) =>
					['ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration'].includes(node.type);

				const checkSpacing = (members) => {
					for (let index = 1; index < members.length; index += 1) {
						const previous = members[index - 1];
						const current = members[index];
						if (
							!isFunctionLike(previous) &&
							!isFunctionLike(current) &&
							!isExport(previous) &&
							!isExport(current)
						) {
							continue;
						}

						const comments = sourceCode.getCommentsBefore(current).filter(
							(comment) =>
								comment.range[0] >= previous.range[1] &&
								// Trailing same-line comments belong to the previous declaration,
								// not to the next one. Only move an actual leading comment group.
								comment.loc.start.line > previous.loc.end.line,
						);
						const boundary = comments[0] ?? current;
						if (boundary.loc.start.line - previous.loc.end.line >= 2) continue;

						context.report({
							node: current,
							messageId: 'needsSpacing',

							fix(fixer) {
								if (boundary.loc.start.line > previous.loc.end.line) {
									const lineStart = sourceCode.getIndexFromLoc({
										line: boundary.loc.start.line,
										column: 0,
									});
									return fixer.insertTextBeforeRange([lineStart, lineStart], lineEnding);
								}

								const line = sourceCode.lines[boundary.loc.start.line - 1] ?? '';
								const indentation = line.match(/^[\t ]*/)?.[0] ?? '';
								return fixer.insertTextBeforeRange(
									[boundary.range[0], boundary.range[0]],
									`${lineEnding}${lineEnding}${indentation}`,
								);
							},
						});
					}
				};

				return {
					Program(node) {
						checkSpacing(node.body);
					},

					BlockStatement(node) {
						checkSpacing(node.body);
					},

					ClassBody(node) {
						checkSpacing(node.body);
					},

					StaticBlock(node) {
						checkSpacing(node.body);
					},

					SwitchCase(node) {
						checkSpacing(node.consequent);
					},

					ObjectExpression(node) {
						checkSpacing(node.properties);
					},
				};
			},
		},
	},
};

export default [
	{
		name: 'nexus/ignores',
		ignores: ['**/dist/**', '**/node_modules/**', '**/data/**'],
	},
	{
		name: 'nexus/agent-typescript',
		files: [
			'packages/backend/src/modules/agent/**/*.ts',
			'packages/backend/src/infrastructure/agent/**/*.ts',
			'packages/backend/src/interfaces/http/agent/**/*.ts',
			'packages/backend/src/interfaces/websocket/agent*.ts',
			'tests/backend/agent-scenarios/**/*.ts',
		],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
			globals: { ...globals.browser, ...globals.node },
		},
		plugins: { '@typescript-eslint': tseslint.plugin },
		rules: {
			'@typescript-eslint/no-unused-vars': unusedRule,
		},
	},
	...vue.configs['flat/essential'],
	{
		name: 'nexus/frontend-typescript',
		files: ['packages/frontend/src/**/*.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
			globals: { ...globals.browser, ...globals.node },
		},
		plugins: { '@typescript-eslint': tseslint.plugin },
		rules: {
			'@typescript-eslint/no-unused-vars': unusedRule,
		},
	},
	{
		name: 'nexus/frontend-vue',
		files: ['packages/frontend/src/**/*.vue'],
		languageOptions: {
			parserOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
			globals: { ...globals.browser, ...globals.node },
		},
		plugins: { '@typescript-eslint': tseslint.plugin },
		rules: {
			'@typescript-eslint/no-unused-vars': unusedRule,
			'vue/no-mutating-props': ['error', { shallowOnly: true }],
			'vue/no-use-v-if-with-v-for': 'error',
		},
	},
	{
		name: 'nexus/typescript-parser',
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
		},
	},
	{
		name: 'nexus/function-spacing',
		files: ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue}'],
		plugins: { 'nexus-style': functionSpacingPlugin },
		rules: { 'nexus-style/function-spacing': 'error' },
	},
];
