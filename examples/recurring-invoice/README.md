# recurring invoice example

comprehensive example of recurring event processing using cron scheduling for monthly invoice generation

## features demonstrated

### 1 cron based scheduling

schedule workflows to run at specific times using cron expressions

```typescript
await world.schedule(
  'monthly-invoices'
  'batch-invoices'
  () => getCustomers()
  '0 9 1 * *' // 9am on 1st of each month
)
```

### 2 dynamic input function

schedule input can be function called fresh each execution

```typescript
() => {
  return {
    customerIds: fetchActiveCustomers()
    month: new Date().getMonth() + 1
    year: new Date().getFullYear()
  }
}
```

### 3 batch processing

process multiple items in parallel with child workflows

```typescript
const results = await Promise.all(
  customerIds.map(id =>
    ctx.executeChild('process-invoice' { customerId: id })
  )
)
```

### 4 compensation logic

automatically void invoice if email sending fails

```typescript
const invoice = await ctx.run(generateInvoice data)
ctx.addCompensation(async () => {
  await ctx.run(voidInvoice invoice.id)
})
```

### 5 retry with backoff

retry invoice generation and email sending with exponential backoff

```typescript
activity('generate-invoice' handler {
  retry: { maxAttempts: 5 backoff: 'exponential' }
})
```

### 6 workflow querying

query completed workflows to get processing statistics

```typescript
const completed = await world.queryWorkflows({
  status: 'completed'
  limit: 100
})
```

## workflow structure

### monthly invoice workflow

processes single customer invoice
1. fetch customer subscription data
2. calculate invoice amount based on plan
3. generate invoice in system
4. send invoice email
5. record invoice sent event

compensation executes if email fails voiding the invoice

### batch invoice workflow

orchestrates multiple invoice generations
1. receives list of customer ids
2. spawns child workflow for each customer
3. waits for all to complete
4. aggregates results
5. returns total statistics

## cron schedule

```
0 9 1 * *
│ │ │ │ │
│ │ │ │ └─ day of week any
│ │ │ └─── month any
│ │ └───── day 1
│ └─────── hour 9
└───────── minute 0
```

executes at 9am on the 1st day of every month

## use cases

- monthly subscription billing
- recurring invoice generation
- scheduled report delivery
- periodic data synchronization
- automated reminder emails
- monthly statement generation
- quarterly tax calculations
- annual renewals

## cron patterns

### common schedules

```typescript
// every day at 9am
'0 9 * * *'

// every monday at 8am
'0 8 * * 1'

// first day of month at midnight
'0 0 1 * *'

// every 15 minutes
'*/15 * * * *'

// weekdays at 6pm
'0 18 * * 1-5'

// last day of month at noon
'0 12 L * *'
```

### multiple schedules

```typescript
// daily invoices
await world.schedule('daily-invoices' workflow {} '0 9 * * *')

// weekly reports
await world.schedule('weekly-reports' workflow {} '0 9 * * 1')

// monthly billing
await world.schedule('monthly-billing' workflow {} '0 0 1 * *')
```

## error handling

### invoice generation fails

retry automatically up to 5 times with exponential backoff
if all retries exhausted workflow fails without sending email

### email sending fails

compensation executes voiding the generated invoice
customer not charged for failed delivery

### batch processing

individual customer failures isolated
other customers continue processing
failed customers tracked in results

## running the example

```bash
npm install
npm start
```

world starts and schedules monthly invoice generation
one time batch execution runs for demonstration
process keeps running to show scheduled execution

press ctrl-c to gracefully shutdown

## integration patterns

### express api

```typescript
app.post('/api/invoices/generate' async (req res) => {
  const handle = await world.execute('batch-invoices' {
    customerIds: req.body.customerIds
    month: req.body.month
    year: req.body.year
  })
  
  res.json({ workflowId: handle.workflowId })
})

app.get('/api/invoices/:workflowId' async (req res) => {
  const state = await world.query(req.params.workflowId)
  res.json(state)
})
```

### manual trigger

```typescript
const handle = await world.execute('batch-invoices' {
  customerIds: ['cust-1' 'cust-2']
  month: 12
  year: 2025
})

const result = await handle.result()
```

### schedule management

```typescript
// pause schedule
await world.pauseSchedule('monthly-invoices')

// resume schedule
await world.resumeSchedule('monthly-invoices')

// delete schedule
await world.deleteSchedule('monthly-invoices')

// list all schedules
const schedules = world.getSchedules()
```

## monitoring

### workflow metrics

```typescript
const metrics = world.getMetrics()
console.log('completed' metrics.workflows.completed)
console.log('failed' metrics.workflows.failed)
console.log('throughput' metrics.throughput.perHour)
```

### query recent invoices

```typescript
const recent = await world.queryWorkflows({
  workflowName: 'monthly-invoice'
  startedAfter: Date.now() - 86400000
  status: 'completed'
})
```

### check schedule status

```typescript
const schedule = world.getSchedule('monthly-invoices')
console.log('next execution' new Date(schedule.nextExecution))
console.log('total executions' schedule.totalExecutions)
```

## customization

### different billing cycles

```typescript
// weekly billing
'0 9 * * 1'

// quarterly billing
'0 9 1 */3 *'

// annual billing
'0 9 1 1 *'
```

### custom invoice logic

modify activities to implement
- tax calculations
- discount application
- payment method selection
- invoice template customization
- multi currency support

### notification channels

extend to send via
- email
- sms
- webhook
- slack
- push notification
