import type {
  AthenaGatewayCallOptions,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaRpcCallOptions,
} from '../gateway/types.ts'
import type {
  AthenaFromOptions,
  AthenaResult,
  AthenaSdkClient,
  MutationQuery,
  RpcQueryBuilder,
  SelectChain,
  TableQueryBuilder,
  UpdateChain,
} from '../client.ts'
import type {
  AthenaModelTarget,
  InsertOf,
  RowOf,
  UpdateOf,
} from '../schema/types.ts'
import type { AthenaSelectInput, AthenaValidatedSelectInput } from '../select-column-types.ts'

type AthenaRowShape = Record<string, AthenaJsonValue | undefined>
type SelectColumnsFor<
  Row,
  TStrict extends boolean,
  TValue extends AthenaSelectInput,
> = TStrict extends true ? AthenaValidatedSelectInput<Row, TValue> : TValue

type AthenaUpsertOptions<Update> = AthenaGatewayCallOptions & {
  updateBody?: Update
  onConflict?: string | string[]
}

export interface AthenaDbModule<TStrict extends boolean = false> {
  from<TModel extends AthenaModelTarget>(
    model: TModel,
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown, TStrict>
  from<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string, options?: AthenaFromOptions): TableQueryBuilder<Row, Insert, Update, unknown, TStrict>

  select<
    Row = AthenaRowShape,
    SelectedRow = Row,
    const TColumns extends AthenaSelectInput = string,
  >(
    table: string,
    columns?: SelectColumnsFor<Row, TStrict, TColumns>,
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Row, SelectedRow, TStrict>

  insert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
  >(table: string, values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row, Row, TStrict>
  insert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
  >(table: string, values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[], Row, TStrict>

  upsert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    values: Insert,
    options?: AthenaUpsertOptions<Update>,
  ): MutationQuery<Row, Row, TStrict>
  upsert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    values: Insert[],
    options?: AthenaUpsertOptions<Update>,
  ): MutationQuery<Row[], Row, TStrict>

  update<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string, values: Update, options?: AthenaGatewayCallOptions): UpdateChain<Row, TStrict>

  delete<Row = AthenaRowShape>(
    table: string,
    options?: AthenaGatewayCallOptions & { resourceId?: string },
  ): MutationQuery<Row | null, Row, TStrict>

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row, TStrict>

  query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>>
}

interface AthenaDbModuleFactoryInput<TStrict extends boolean = false> {
  from: AthenaSdkClient<TStrict>['from']
  rpc: AthenaSdkClient<TStrict>['rpc']
  query: AthenaSdkClient<TStrict>['query']
}

export function createDbModule<TStrict extends boolean = false>(
  input: AthenaDbModuleFactoryInput<TStrict>,
): AthenaDbModule<TStrict> {
  const db: AthenaDbModule<TStrict> = {
    from: input.from,
    select<
      Row = AthenaRowShape,
      SelectedRow = Row,
      const TColumns extends AthenaSelectInput = string,
    >(
      table: string,
      columns?: SelectColumnsFor<Row, TStrict, TColumns>,
      options?: AthenaGatewayCallOptions,
    ) {
      return input.from<Row>(table).select<SelectedRow, TColumns>(columns, options)
    },
    insert<Row = AthenaRowShape, Insert = Partial<Row>>(
      table: string,
      values: Insert | Insert[],
      options?: AthenaGatewayCallOptions,
    ): MutationQuery<Row> | MutationQuery<Row[]> {
      return Array.isArray(values)
        ? input.from<Row, Insert, Partial<Insert>>(table).insert(values, options)
        : input.from<Row, Insert, Partial<Insert>>(table).insert(values, options)
    },
    upsert<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(
      table: string,
      values: Insert | Insert[],
      options?: AthenaUpsertOptions<Update>,
    ): MutationQuery<Row> | MutationQuery<Row[]> {
      return Array.isArray(values)
        ? input.from<Row, Insert, Update>(table).upsert(values, options)
        : input.from<Row, Insert, Update>(table).upsert(values, options)
    },
    update<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(
      table: string,
      values: Update,
      options?: AthenaGatewayCallOptions,
    ) {
      return input.from<Row, Insert, Update>(table).update(values, options)
    },
    delete<Row = AthenaRowShape>(
      table: string,
      options?: AthenaGatewayCallOptions & { resourceId?: string },
    ) {
      return input.from<Row>(table).delete(options)
    },
    rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
      fn: string,
      args?: Args,
      options?: AthenaRpcCallOptions,
    ) {
      return input.rpc<Row, Args>(fn, args, options)
    },
    query<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) {
      return input.query<Row>(query, options)
    },
  }

  return db
}
