import { World, workflow, activity } from '../../src/index'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || 'https://demo.supabase.co'
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'demo-key'

const supabase = createClient(supabaseUrl, supabaseKey)

const fetchFromSupabase = activity('fetch-supabase', async (ctx, { table, filters = {}, select = '*' }) => {
  ctx.heartbeat(`fetching from ${table}`)
  
  let query = supabase.from(table).select(select)
  
  Object.entries(filters).forEach(([key, value]) => {
    query = query.eq(key, value)
  })
  
  const { data, error } = await query
  
  if (error) {
    throw new Error(`supabase query failed: ${error.message}`)
  }
  
  console.log(`fetched ${data?.length || 0} rows from ${table}`)
  return { data, count: data?.length || 0 }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const insertIntoSupabase = activity('insert-supabase', async (ctx, { table, data }) => {
  ctx.heartbeat(`inserting into ${table}`)
  
  const { data: result, error } = await supabase
    .from(table)
    .insert(data)
    .select()
  
  if (error) {
    throw new Error(`supabase insert failed: ${error.message}`)
  }
  
  console.log(`inserted ${result?.length || 0} rows into ${table}`)
  return { data: result, inserted: result?.length || 0 }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const updateInSupabase = activity('update-supabase', async (ctx, { table, id, updates }) => {
  ctx.heartbeat(`updating ${table} id ${id}`)
  
  const { data, error } = await supabase
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
  
  if (error) {
    throw new Error(`supabase update failed: ${error.message}`)
  }
  
  console.log(`updated row in ${table}`)
  return { data, updated: true }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const supabaseWorkflow = workflow('supabase-workflow', async (ctx, { action, userId, userData }) => {
  console.log(`starting supabase workflow: ${action}`)
  
  if (action === 'fetch') {
    const users = await ctx.run(fetchFromSupabase, {
      table: 'users',
      filters: userId ? { id: userId } : {},
      select: 'id,email,name'
    })
    return { action: 'fetch', users: users.data, count: users.count }
  }
  
  if (action === 'create') {
    const newUser = await ctx.run(insertIntoSupabase, {
      table: 'users',
      data: {
        email: userData.email,
        name: userData.name
      }
    })
    
    if (newUser.data && newUser.data[0]) {
      const updated = await ctx.run(updateInSupabase, {
        table: 'users',
        id: newUser.data[0].id,
        updates: { updated_at: new Date().toISOString() }
      })
      
      return { action: 'create', user: updated.data[0] }
    }
    
    return { action: 'create', user: newUser.data?.[0] }
  }
  
  throw new Error(`unknown action: ${action}`)
})

const world = new World({
  minWorkers: 2,
  maxWorkers: 4,
  persistence: 'memory'
})

world.register(
  supabaseWorkflow,
  fetchFromSupabase,
  insertIntoSupabase,
  updateInSupabase
)

await world.start()

console.log('supabase fetch workflow example')
console.log('set SUPABASE_URL and SUPABASE_ANON_KEY to use real supabase\n')

const handle = await world.execute('supabase-workflow', {
  action: 'create',
  userData: {
    email: 'test@example.com',
    name: 'test user'
  }
})

console.log(`workflow started: ${handle.workflowId}`)

const result = await handle.result()
console.log('\nworkflow completed:', result)

await world.shutdown()

