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

type AthenaRowShape = Record<string, AthenaJsonValue | undefined>

type AthenaUpsertOptions<Update> = AthenaGatewayCallOptions & {
  updateBody?: Update
  onConflict?: string | string[]
}

export interface AthenaDbModule {
  from<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string, options?: AthenaFromOptions): TableQueryBuilder<Row, Insert, Update>

  select<
    Row = AthenaRowShape,
    SelectedRow = Row,
  >(
    table: string,
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
  ): SelectChain<Row, SelectedRow>

  insert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
  >(table: string, values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row>
  insert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
  >(table: string, values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[]>

  upsert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    values: Insert,
    options?: AthenaUpsertOptions<Update>,
  ): MutationQuery<Row>
  upsert<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    values: Insert[],
    options?: AthenaUpsertOptions<Update>,
  ): MutationQuery<Row[]>

  update<
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string, values: Update, options?: AthenaGatewayCallOptions): UpdateChain<Row>

  delete<Row = AthenaRowShape>(
    table: string,
    options?: AthenaGatewayCallOptions & { resourceId?: string },
  ): MutationQuery<Row | null>

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row>

  query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>>
}

interface AthenaDbModuleFactoryInput {
  from: AthenaSdkClient['from']
  rpc: AthenaSdkClient['rpc']
  query: AthenaSdkClient['query']
}

export function createDbModule(input: AthenaDbModuleFactoryInput): AthenaDbModule {
  const db: AthenaDbModule = {
    from<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(
      table: string,
      options?: AthenaFromOptions,
    ) {
      return input.from<Row, Insert, Update>(table, options)
    },
    select<
      Row = AthenaRowShape,
      SelectedRow = Row,
    >(
      table: string,
      columns?: string | string[],
      options?: AthenaGatewayCallOptions,
    ) {
      return input.from<Row>(table).select<SelectedRow>(columns, options)
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
