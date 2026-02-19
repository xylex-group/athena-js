import { World, workflow, activity } from '../../src/index'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/dbname'

const pool = new Pool({
  connectionString,
  max: 5
})

const queryPostgres = activity('query-postgres', async (ctx, { sql, params = [] }) => {
  ctx.heartbeat('executing query')
  
  if (!process.env.DATABASE_URL || connectionString.includes('localhost')) {
    console.log(`[DEMO] would execute: ${sql}`)
    await sleep(300)
    return { rows: [], rowCount: 0 }
  }
  
  const client = await pool.connect()
  
  try {
    const result = await client.query(sql, params)
    console.log(`query executed: ${result.rowCount} rows`)
    return { rows: result.rows, rowCount: result.rowCount }
  } finally {
    client.release()
  }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' },
  timeout: '30s'
})

const postgresWorkflow = workflow('postgres-workflow', async (ctx, { action, tableName, data }) => {
  console.log(`starting postgres workflow: ${action}`)
  
  if (action === 'setup') {
    const createSql = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `
    await ctx.run(queryPostgres, { sql: createSql })
    
    const columns = Object.keys(data).join(', ')
    const values = Object.values(data)
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ')
    const insertSql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders}) RETURNING *`
    
    const inserted = await ctx.run(queryPostgres, { sql: insertSql, params: values })
    
    return { action: 'setup', table: tableName, record: inserted.rows[0] }
  }
  
  if (action === 'query') {
    let sql = `SELECT * FROM ${tableName}`
    const params: any[] = []
    
    if (data.where && Object.keys(data.where).length > 0) {
      const conditions = Object.entries(data.where).map(([key, value]) => {
        params.push(value)
        return `${key} = $${params.length}`
      })
      sql += ` WHERE ${conditions.join(' AND ')}`
    }
    
    sql += ` LIMIT $${params.length + 1}`
    params.push(data.limit || 10)
    
    const results = await ctx.run(queryPostgres, { sql, params })
    
    return { action: 'query', table: tableName, records: results.rows, count: results.rowCount }
  }
  
  if (action === 'update') {
    const setClause = Object.keys(data.updates).map((key, index) => `${key} = $${index + 1}`).join(', ')
    const values = Object.values(data.updates)
    values.push(data.id)
    const sql = `UPDATE ${tableName} SET ${setClause} WHERE id = $${values.length} RETURNING *`
    
    const updated = await ctx.run(queryPostgres, { sql, params: values })
    
    return { action: 'update', table: tableName, record: updated.rows[0] }
  }
  
  throw new Error(`unknown action: ${action}`)
})

const world = new World({
  minWorkers: 2,
  maxWorkers: 5,
  persistence: 'memory'
})

world.register(
  postgresWorkflow,
  queryPostgres
)

await world.start()

console.log('postgres connection workflow example')
console.log('set DATABASE_URL environment variable to use real postgres\n')

const handle = await world.execute('postgres-workflow', {
  action: 'setup',
  tableName: 'users',
  data: {
    name: 'test user',
    email: 'test@example.com'
  }
})

console.log(`workflow started: ${handle.workflowId}`)

const result = await handle.result()
console.log('\nworkflow completed:', result)

await pool.end()
await world.shutdown()

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

