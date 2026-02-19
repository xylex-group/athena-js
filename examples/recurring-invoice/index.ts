/**
 * recurring invoice example
 * 
 * demonstrates creating recurring events like monthly invoices with scheduling
 * retry logic and failure handling for invoice generation and sending
 */

import { World, workflow, activity } from '../../src/index'

// simulate invoice data structure
interface Invoice {
  id: string
  customerId: string
  amount: number
  dueDate: Date
  items: Array<{ description: string; amount: number }>
}

interface Customer {
  id: string
  email: string
  name: string
  subscriptionPlan: string
}

// activity to fetch customer subscription data
const getCustomerSubscription = activity('get-subscription', async (ctx, { customerId }) => {
  ctx.heartbeat('fetching customer data')
  
  // simulate database lookup
  const customer: Customer = {
    id: customerId,
    email: `customer-${customerId}@example.com`,
    name: `Customer ${customerId}`,
    subscriptionPlan: 'pro'
  }
  
  return customer
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' },
  timeout: '10s'
})

// activity to calculate invoice amount
const calculateInvoiceAmount = activity('calculate-invoice', async (ctx, { customer }) => {
  ctx.heartbeat('calculating invoice amount')
  
  const planPrices = {
    basic: 9.99,
    pro: 29.99,
    enterprise: 99.99
  }
  
  const amount = planPrices[customer.subscriptionPlan] || 0
  
  return {
    amount,
    items: [
      { description: `${customer.subscriptionPlan} plan subscription`, amount }
    ]
  }
}, {
  retry: { maxAttempts: 2, backoff: 'constant', initialInterval: 1000 }
})

// activity to generate invoice in system
const generateInvoice = activity('generate-invoice', async (ctx, { customer, amount, items }) => {
  ctx.heartbeat('generating invoice')
  
  const invoiceId = `INV-${Date.now()}-${customer.id}`
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
  
  const invoice: Invoice = {
    id: invoiceId,
    customerId: customer.id,
    amount,
    dueDate,
    items
  }
  
  // simulate database save
  console.log(`  generated invoice ${invoiceId} for ${customer.name} amount $${amount}`)
  
  return invoice
}, {
  retry: { maxAttempts: 5, backoff: 'exponential' },
  timeout: '30s'
})

// activity to send invoice email
const sendInvoiceEmail = activity('send-invoice-email', async (ctx, { customer, invoice }) => {
  ctx.heartbeat(`sending to ${customer.email}`)
  
  // simulate email sending
  console.log(`  sent invoice ${invoice.id} to ${customer.email}`)
  
  return { sent: true, sentAt: Date.now() }
}, {
  retry: { maxAttempts: 5, backoff: 'exponential' },
  timeout: '30s'
})

// activity to record invoice sent event
const recordInvoiceSent = activity('record-invoice-sent', async (ctx, { invoice, sentAt }) => {
  ctx.heartbeat('recording event')
  
  // simulate event storage
  console.log(`  recorded invoice sent event for ${invoice.id}`)
  
  return { recorded: true }
})

// workflow to process single invoice generation
const monthlyInvoiceWorkflow = workflow('monthly-invoice', async (ctx, { customerId, month, year }) => {
  console.log(`\nprocessing invoice for customer ${customerId} ${month}/${year}`)
  
  // fetch customer data
  const customer = await ctx.run(getCustomerSubscription, { customerId })
  
  // calculate invoice amount
  const invoiceData = await ctx.run(calculateInvoiceAmount, { customer })
  
  // generate invoice with compensation
  const invoice = await ctx.run(generateInvoice, {
    customer,
    amount: invoiceData.amount,
    items: invoiceData.items
  })
  
  // add compensation to void invoice if email fails
  ctx.addCompensation(async () => {
    console.log(`  compensating voiding invoice ${invoice.id}`)
    // void invoice logic would go here
  })
  
  // send invoice email
  const emailResult = await ctx.run(sendInvoiceEmail, { customer, invoice })
  
  // record the event
  await ctx.run(recordInvoiceSent, { invoice, sentAt: emailResult.sentAt })
  
  return {
    invoiceId: invoice.id,
    customerId: customer.id,
    amount: invoice.amount,
    sent: true
  }
}, {
  failureStrategy: 'compensate'
})

// workflow to process batch of invoices
const batchInvoiceWorkflow = workflow('batch-invoices', async (ctx, { customerIds, month, year }) => {
  console.log(`\nprocessing batch of ${customerIds.length} invoices for ${month}/${year}`)
  
  // process all customers in parallel
  const results = await Promise.all(
    customerIds.map(customerId =>
      ctx.executeChild('monthly-invoice', { customerId, month, year })
    )
  )
  
  // wait for all to complete
  const invoices = await Promise.all(results.map(r => r.result()))
  
  const successful = invoices.filter(inv => inv.sent).length
  const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0)
  
  return {
    month,
    year,
    totalInvoices: customerIds.length,
    successful,
    totalAmount
  }
})

// setup world and register workflows
const world = new World({
  minWorkers: 2,
  maxWorkers: 8,
  persistence: 'hybrid',
  persistencePath: '.athena-js-invoices'
})

world.register(
  monthlyInvoiceWorkflow,
  batchInvoiceWorkflow,
  getCustomerSubscription,
  calculateInvoiceAmount,
  generateInvoice,
  sendInvoiceEmail,
  recordInvoiceSent
)

await world.start()

// schedule monthly invoice generation on the 1st of each month at 9am
console.log('scheduling monthly invoice generation')
await world.schedule(
  'monthly-invoices',
  'batch-invoices',
  () => {
    // function called each time to get fresh customer list
    const now = new Date()
    return {
      customerIds: ['cust-1', 'cust-2', 'cust-3', 'cust-4', 'cust-5'],
      month: now.getMonth() + 1,
      year: now.getFullYear()
    }
  },
  '0 9 1 * *' // cron: at 9am on day 1 of every month
)

console.log('monthly invoice workflow scheduled')

// demonstrate one-time execution for current month
console.log('\nexecuting one-time invoice batch for demonstration')
const now = new Date()
const handle = await world.execute('batch-invoices', {
  customerIds: ['cust-1', 'cust-2', 'cust-3'],
  month: now.getMonth() + 1,
  year: now.getFullYear()
})

// wait for completion
const result = await handle.result()

console.log('\nbatch invoice results')
console.log(`  total invoices ${result.totalInvoices}`)
console.log(`  successful ${result.successful}`)
console.log(`  total amount $${result.totalAmount.toFixed(2)}`)

// query all completed invoices
const completed = await world.queryWorkflows({
  status: 'completed',
  limit: 10
})

console.log(`\ncompleted workflows ${completed.length}`)

// keep running to show scheduled execution
console.log('\nworld running press ctrl-c to stop')
console.log('monthly invoices will generate on 1st of each month at 9am')

// graceful shutdown handler
process.on('SIGINT', async () => {
  console.log('\nshutting down')
  await world.shutdown()
  process.exit(0)
})
