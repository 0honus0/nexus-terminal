import {
	AliasNode,
	IdentifierNode,
	ListNode,
	OperationNodeTransformer,
	QueryNode,
	SqliteQueryCompiler,
	TableNode,
	type CommonTableExpressionNameNode,
	type CreateIndexNode,
	type CreateViewNode,
	type DropIndexNode,
	type DropViewNode,
	type OperationNode,
	type QueryId,
	type ReferenceNode,
	type RootOperationNode,
	type SchemableIdentifierNode,
} from 'kysely';

interface QueryScope {
	readonly ctes: ReadonlySet<string>;
	readonly references: Map<string, boolean>;
}

function sqliteName(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** 公共 SQL 构造器使用逻辑表名，生成的 SQL 只访问当前插件的物理表。 */
export class PluginQueryCompiler extends SqliteQueryCompiler {
	readonly #prefix: string;

	constructor(prefix: string) {
		super();
		this.#prefix = prefix;
	}

	override compileQuery(node: RootOperationNode, queryId: QueryId) {
		return super.compileQuery(new PluginTableNames(this.#prefix).transformNode(node, queryId), queryId);
	}
}

class PluginTableNames extends OperationNodeTransformer {
	readonly #prefix: string;
	readonly #scopes: QueryScope[] = [];

	constructor(prefix: string) {
		super();
		this.#prefix = prefix;
	}

	protected override transformNodeImpl<T extends OperationNode>(node: T, queryId?: QueryId): T {
		if (!QueryNode.is(node)) return super.transformNodeImpl(node, queryId);
		const scope: QueryScope = {
			ctes: new Set(node.with?.expressions.map(({ name }) => this.#name(name.table))),
			references: new Map(),
		};
		this.#scopes.push(scope);
		try {
			if ('from' in node) node.from?.froms.forEach((source) => this.#addReference(scope, source));
			if ('into' in node && node.into) this.#addReference(scope, node.into);
			if ('table' in node && node.table) this.#addReference(scope, node.table);
			if ('joins' in node) node.joins?.forEach(({ table }) => this.#addReference(scope, table));
			return super.transformNodeImpl(node, queryId);
		} finally {
			this.#scopes.pop();
		}
	}

	protected override transformTable(node: TableNode): TableNode {
		return this.#isCte(node) ? node : this.#physicalTable(node);
	}

	protected override transformReference(node: ReferenceNode): ReferenceNode {
		if (!node.table) return node;
		if (node.table.table.schema) return { ...node, table: this.#physicalTable(node.table) };
		const name = this.#name(node.table);
		// 列限定名使用最近一层查询的表或别名，包含子查询对外层表的引用。
		for (let index = this.#scopes.length - 1; index >= 0; index--) {
			const physical = this.#scopes[index].references.get(name);
			if (physical !== undefined) return physical ? { ...node, table: this.#physicalTable(node.table) } : node;
		}
		return node;
	}

	protected override transformCommonTableExpressionName(
		node: CommonTableExpressionNameNode,
	): CommonTableExpressionNameNode {
		return node;
	}

	protected override transformCreateIndex(node: CreateIndexNode, queryId?: QueryId): CreateIndexNode {
		return {
			...super.transformCreateIndex(node, queryId),
			name: IdentifierNode.create(this.#prefix + node.name.name),
		};
	}

	protected override transformDropIndex(node: DropIndexNode, queryId?: QueryId): DropIndexNode {
		return { ...super.transformDropIndex(node, queryId), name: this.#physicalName(node.name) };
	}

	protected override transformCreateView(node: CreateViewNode, queryId?: QueryId): CreateViewNode {
		return { ...super.transformCreateView(node, queryId), name: this.#physicalName(node.name) };
	}

	protected override transformDropView(node: DropViewNode, queryId?: QueryId): DropViewNode {
		return { ...super.transformDropView(node, queryId), name: this.#physicalName(node.name) };
	}

	#addReference(scope: QueryScope, node: OperationNode): void {
		if (TableNode.is(node)) scope.references.set(this.#name(node), !this.#isCte(node));
		else if (AliasNode.is(node) && IdentifierNode.is(node.alias))
			scope.references.set(sqliteName(node.alias.name), false);
		else if (ListNode.is(node)) node.items.forEach((entry) => this.#addReference(scope, entry));
	}

	#isCte(node: TableNode): boolean {
		return !node.table.schema && this.#scopes.some(({ ctes }) => ctes.has(this.#name(node)));
	}

	#name(node: TableNode): string {
		return sqliteName(node.table.identifier.name);
	}

	#physicalTable(node: TableNode): TableNode {
		return { ...node, table: this.#physicalName(node.table) };
	}

	#physicalName(node: SchemableIdentifierNode): SchemableIdentifierNode {
		// Kysely 自带的 SQLite 内省通过 sqlite_master 读取系统目录。
		if (sqliteName(node.identifier.name) === 'sqlite_master') return node;
		return { ...node, identifier: IdentifierNode.create(this.#prefix + node.identifier.name) };
	}
}
