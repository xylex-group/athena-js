import { World, workflow, activity } from '../../src/index'

interface SourceRecord {
  id: string
  name: string
  email: string
  amount: number
  date: string
}

interface TransformedRecord {
  id: string
  customerName: string
  customerEmail: string
  transactionAmount: number
  transactionDate: Date
  processedAt: string
}

const extractData = activity('extract-data', async (ctx, { source }) => {
  ctx.heartbeat('extracting data')
  
  await sleep(1000)
  
  const mockData: SourceRecord[] = [
    { id: '1', name: 'alice', email: 'alice@example.com', amount: 100.50, date: '2024-01-15' },
    { id: '2', name: 'bob', email: 'bob@example.com', amount: 250.75, date: '2024-01-16' },
    { id: '3', name: 'charlie', email: 'charlie@example.com', amount: 75.25, date: '2024-01-17' }
  ]
  
  console.log(`extracted ${mockData.length} records from ${source}`)
  return { records: mockData, source }
}, {
  retry: { maxAttempts: 2, backoff: 'linear' }
})

const transformRecord = activity('transform-record', async (ctx, record: SourceRecord) => {
  ctx.heartbeat(`transforming record ${record.id}`)
  
  await sleep(200)
  
  const transformed: TransformedRecord = {
    id: record.id,
    customerName: record.name.toUpperCase(),
    customerEmail: record.email.toLowerCase(),
    transactionAmount: record.amount,
    transactionDate: new Date(record.date),
    processedAt: new Date().toISOString()
  }
  
  return transformed
}, {
  retry: { maxAttempts: 2, backoff: 'linear' }
})

const validateRecord = activity('validate-record', async (ctx, record: TransformedRecord) => {
  ctx.heartbeat(`validating record ${record.id}`)
  
  await sleep(100)
  
  if (!record.customerEmail.includes('@')) {
    throw new Error(`invalid email: ${record.customerEmail}`)
  }
  
  if (record.transactionAmount <= 0) {
    throw new Error(`invalid amount: ${record.transactionAmount}`)
  }
  
  return { ...record, validated: true }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const loadData = activity('load-data', async (ctx, { records, destination }) => {
  ctx.heartbeat(`loading ${records.length} records`)
  
  await sleep(500)
  
  console.log(`loaded ${records.length} records into ${destination}`)
  
  return {
    loaded: records.length,
    destination,
    timestamp: new Date().toISOString()
  }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const etlWorkflow = workflow('etl-workflow', async (ctx, { source, destination }) => {
  console.log(`starting etl workflow: ${source} -> ${destination}`)
  
  const extraction = await ctx.run(extractData, { source })
  const records = extraction.records
  
  console.log(`extracted ${records.length} records`)
  
  const transformed = await Promise.all(
    records.map(record => ctx.run(transformRecord, record))
  )
  
  console.log(`transformed ${transformed.length} records`)
  
  const validated = await Promise.all(
    transformed.map(record => ctx.run(validateRecord, record))
  )
  
  console.log(`validated ${validated.length} records`)
  
  const loadResult = await ctx.run(loadData, {
    records: validated,
    destination
  })
  
  return {
    extracted: records.length,
    transformed: transformed.length,
    validated: validated.length,
    loaded: loadResult.loaded,
    destination: loadResult.destination
  }
})

const world = new World({
  minWorkers: 3,
  maxWorkers: 8,
  persistence: 'memory'
})

world.register(
  etlWorkflow,
  extractData,
  transformRecord,
  validateRecord,
  loadData
)

await world.start()

console.log('etl workflow example\n')

const handle = await world.execute('etl-workflow', {
  source: 'api-endpoint',
  destination: 'data-warehouse'
})

console.log(`workflow started: ${handle.workflowId}`)

const result = await handle.result()
console.log('\nworkflow completed:', result)

await world.shutdown()

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

