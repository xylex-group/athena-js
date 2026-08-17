import type {
  AthenaFromOptions,
  MutationQuery,
  RpcQueryBuilder,
  SelectChain,
  TableQueryBuilder,
  UpdateChain,
} from "../client.ts";
import type { AthenaResult } from "../client-result.ts";
import type { AthenaExecutable } from "../query/descriptor.ts";
import type {
  AthenaTransactionOptions,
  AthenaTransactionResults,
} from "./transaction/types.ts";
import type {
  AthenaGatewayCallOptions,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaRpcCallOptions,
} from "../gateway/types.ts";
import type {
  AthenaClientModelForTableName,
  AthenaClientTableName,
  AthenaModelTarget,
  InsertOf,
  RowOf,
  UpdateOf,
} from "../schema/types.ts";
import type { AthenaSelectInput } from "../select-column-types.ts";

type AthenaRowShape = Record<string, AthenaJsonValue | undefined>;
type UntypedTableName<TModels> = [TModels] extends [never]
  ? string
  : [AthenaClientTableName<TModels>] extends [never]
    ? string
    : AthenaClientTableName<TModels>;
type ResolvedClientTableModel<TModels, TTableName extends string> = Extract<
  AthenaClientModelForTableName<TModels, TTableName>,
  AthenaModelTarget
>;
type ClientTableQueryBuilder<
  TModels,
  TTableName extends string,
> = TableQueryBuilder<
  RowOf<ResolvedClientTableModel<TModels, TTableName>>,
  InsertOf<ResolvedClientTableModel<TModels, TTableName>>,
  UpdateOf<ResolvedClientTableModel<TModels, TTableName>>
>;

type AthenaUpsertOptions<Update> = AthenaGatewayCallOptions & {
  updateBody?: Update;
  onConflict?: string | string[];
};

export interface AthenaTransactionClient<TModels = never>
  extends Pick<
    AthenaDbModule<TModels>,
    "delete" | "from" | "insert" | "select" | "update" | "upsert"
  > {
  abort: () => void;
  withSavepoint: <T>(
    callback: (tx: AthenaTransactionClient<TModels>) => Promise<T>
  ) => Promise<T>;
  withTransaction: <T>(
    callback: (tx: AthenaTransactionClient<TModels>) => Promise<T>
  ) => Promise<T>;
}

export interface AthenaDbModule<TModels = never> {
  delete: <Row = AthenaRowShape>(
    table: UntypedTableName<TModels>,
    options?: AthenaGatewayCallOptions & { resourceId?: string }
  ) => MutationQuery<Row | null, Row>;
  from<TModel extends AthenaModelTarget>(
    model: TModel
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>>;
  from<TTableName extends AthenaClientTableName<TModels>>(
    table: TTableName,
    options?: AthenaFromOptions
  ): ClientTableQueryBuilder<TModels, TTableName>;
  from<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: UntypedTableName<TModels>,
    options?: AthenaFromOptions
  ): TableQueryBuilder<Row, Insert, Update>;

  insert<Row = AthenaRowShape, Insert = Partial<Row>>(
    table: UntypedTableName<TModels>,
    values: Insert,
    options?: AthenaGatewayCallOptions
  ): MutationQuery<Row, Row>;
  insert<Row = AthenaRowShape, Insert = Partial<Row>>(
    table: UntypedTableName<TModels>,
    values: Insert[],
    options?: AthenaGatewayCallOptions
  ): MutationQuery<Row[], Row>;
  query: <Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaResult<Row[]>>;
  rpc: <Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions
  ) => RpcQueryBuilder<Row>;
  transaction<const T extends readonly AthenaExecutable<unknown>[]>(
    operations: T,
    options?: AthenaTransactionOptions
  ): Promise<AthenaTransactionResults<T>>;
  withTransaction<T>(
    callback: (tx: AthenaTransactionClient<TModels>) => Promise<T>,
    options?: AthenaTransactionOptions
  ): Promise<T>;

  select<Row = AthenaRowShape>(
    table: UntypedTableName<TModels>,
    options?: AthenaGatewayCallOptions
  ): SelectChain<Row, Row>;
  select(
    table: UntypedTableName<TModels>,
    columns: AthenaSelectInput,
    options?: AthenaGatewayCallOptions
  ): SelectChain<AthenaRowShape, AthenaRowShape>;

  update: <
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: UntypedTableName<TModels>,
    values: Update,
    options?: AthenaGatewayCallOptions
  ) => UpdateChain<Row>;

  upsert<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: UntypedTableName<TModels>,
    values: Insert,
    options?: AthenaUpsertOptions<Update>
  ): MutationQuery<Row, Row>;
  upsert<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: UntypedTableName<TModels>,
    values: Insert[],
    options?: AthenaUpsertOptions<Update>
  ): MutationQuery<Row[], Row>;
}
