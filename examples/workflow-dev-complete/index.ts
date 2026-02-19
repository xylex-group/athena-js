/**
 * complete workflow dev style example
 * 
 * demonstrates all features from workflow dev kit api
 * - use workflow and use step directives
 * - deterministic execution and replay
 * - sandboxing for workflows
 * - step functions for side effects
 * - workflow functions for pure orchestration
 * - worlds for infrastructure abstraction
 * - hooks and webhooks
 * - streaming
 * - metadata access
 */

import { World, workflow, activity, LocalBackend, start, resumeHook, getRun, initializeRuntime } from '../../src/index'
import {
  getWorkflowMetadata,
  getStepMetadata,
  sleep,
  fetch,
  createHook,
  createWebhook,
  getWritable
} from '../../src/index.js'

/**
 * step function examples
 * 
 * steps are side effecting operations that can interact with external systems
 * they are retryable and can be tracked independently
 */

const sendEmail = activity('send-email', async (ctx, email: { to: string; subject: string; body: string }) => {
  console.log(`STEP: sending email to ${email.to}`)
  
  // simulate api call
  await new Promise(resolve => setTimeout(resolve, 100))
  
  // report progress via heartbeat
  ctx.heartbeat('email sent successfully')
  
  return { messageId: `msg-${Date.now()}`, success: true }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential', initialInterval: 1000 }
})

const createOrder = activity('create-order', async (ctx, order: { userId: string; items: string[] }) => {
  console.log(`STEP: creating order for user ${order.userId}`)
  
  // simulate database write
  await new Promise(resolve => setTimeout(resolve, 50))
  
  const orderId = `order-${Math.random().toString(36).substring(7)}`
  
  return { orderId, status: 'pending', items: order.items }
})

const chargePayment = activity('charge-payment', async (ctx, payment: { orderId: string; amount: number }) => {
  console.log(`STEP: charging payment for order ${payment.orderId}`)
  
  // simulate payment gateway
  await new Promise(resolve => setTimeout(resolve, 200))
  
  // 10 percent chance of transient failure
  if (Math.random() < 0.1) {
    throw new Error('payment gateway timeout')
  }
  
  return { transactionId: `txn-${Date.now()}`, charged: true }
}, {
  retry: { maxAttempts: 5, backoff: 'exponential' },
  timeout: 5000
})

const fetchExternalData = activity('fetch-external', async (ctx, url: string) => {
  console.log(`STEP: fetching data from ${url}`)
  
  // use workflow fetch for automatic retry
  const response = await fetch(url)
  const data = await response.json()
  
  return data
})

/**
 * workflow function examples
 * 
 * workflows are pure orchestrators that coordinate steps
 * they are deterministic and can be replayed safely
 */

const orderWorkflow = workflow('order-workflow', async (ctx, input: { userId: string; items: string[]; email: string }) => {
  console.log('WORKFLOW: starting order workflow')
  
  // get workflow metadata
  const metadata = ctx.getMetadata()
  console.log(`WORKFLOW: running in workflow ${metadata.workflowId}`)
  
  // create the order
  const order = await ctx.run(createOrder, { userId: input.userId, items: input.items })
  
  // add compensation in case of failure
  ctx.addCompensation(async () => {
    console.log(`COMPENSATION: canceling order ${order.orderId}`)
  })
  
  // charge payment
  const payment = await ctx.run(chargePayment, { orderId: order.orderId, amount: 100 })
  
  // add compensation for payment
  ctx.addCompensation(async () => {
    console.log(`COMPENSATION: refunding payment ${payment.transactionId}`)
  })
  
  // send confirmation email
  await ctx.run(sendEmail, {
    to: input.email,
    subject: 'order confirmed',
    body: `your order ${order.orderId} has been confirmed`
  })
  
  console.log('WORKFLOW: order workflow completed')
  
  return { orderId: order.orderId, status: 'confirmed' }
}, {
  failureStrategy: 'compensate'
})

const scheduledReportWorkflow = workflow('scheduled-report', async (ctx, config: { reportType: string }) => {
  console.log(`WORKFLOW: generating ${config.reportType} report`)
  
  // deterministic sleep for 1 second
  await ctx.sleep(1000)
  
  // get current metadata
  const metadata = ctx.getMetadata()
  
  console.log(`WORKFLOW: report generated at ${metadata.startedAt}`)
  
  return { reportId: `report-${Date.now()}`, type: config.reportType }
})

const hookDemoWorkflow = workflow('hook-demo', async (ctx, input: { userId: string }) => {
  console.log('WORKFLOW: waiting for external approval via hook')
  
  // create a hook that external systems can call
  const approvalHook = await ctx.createHook<{ approved: boolean; approver: string }>()
  
  console.log(`WORKFLOW: hook created with token ${approvalHook.token}`)
  console.log(`WORKFLOW: waiting for approval...`)
  
  // workflow suspends here until hook is resolved
  const approval = await approvalHook.wait()
  
  console.log(`WORKFLOW: approval received from ${approval.approver}: ${approval.approved}`)
  
  if (!approval.approved) {
    throw new Error('workflow rejected by approver')
  }
  
  return { status: 'approved', approver: approval.approver }
})

const webhookDemoWorkflow = workflow('webhook-demo', async (ctx, input: { orderId: string }) => {
  console.log('WORKFLOW: waiting for webhook callback')
  
  // create a webhook endpoint
  const webhook = await ctx.createWebhook()
  
  console.log(`WORKFLOW: webhook created at ${webhook.url}`)
  console.log(`WORKFLOW: send POST request to this url to continue workflow`)
  
  // workflow suspends until webhook receives request
  const request = await webhook.wait()
  
  console.log(`WORKFLOW: webhook received ${request.method} request`)
  
  return { status: 'webhook received', url: webhook.url }
})

const streamingWorkflow = workflow('streaming-workflow', async (ctx, input: { items: string[] }) => {
  console.log('WORKFLOW: streaming progress updates')
  
  // get writable stream for this workflow
  const stream = ctx.getWritable()
  const writer = stream.getWriter()
  
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]
    
    // simulate processing
    await ctx.sleep(500)
    
    // stream progress update
    await writer.write({
      progress: ((i + 1) / input.items.length) * 100,
      currentItem: item,
      timestamp: Date.now()
    })
    
    console.log(`WORKFLOW: processed item ${i + 1}/${input.items.length}: ${item}`)
  }
  
  await writer.close()
  
  return { processed: input.items.length }
})

const parentChildWorkflow = workflow('parent-child', async (ctx, input: { tasks: string[] }) => {
  console.log('WORKFLOW: spawning child workflows')
  
  const childHandles = []
  
  for (const task of input.tasks) {
    const child = await ctx.executeChild('scheduled-report', { reportType: task })
    childHandles.push(child)
  }
  
  console.log(`WORKFLOW: waiting for ${childHandles.length} children to complete`)
  
  const results = await Promise.all(
    childHandles.map(child => child.result())
  )
  
  console.log('WORKFLOW: all children completed')
  
  return { childResults: results }
})

/**
 * main example execution
 */

async function main() {
  console.log('worlds-engine workflow dev complete example')
  console.log('demonstrating all workflow dev kit features')
  console.log()
  
  // create a local backend for infrastructure
  const backend = new LocalBackend()
  
  // create world with backend
  const world = new World({
    minWorkers: 2,
    maxWorkers: 5,
    persistence: 'hybrid',
    failureStrategy: 'compensate'
  }, backend)
  
  // register all workflows and activities
  world.register(
    sendEmail,
    createOrder,
    chargePayment,
    fetchExternalData,
    orderWorkflow,
    scheduledReportWorkflow,
    hookDemoWorkflow,
    webhookDemoWorkflow,
    streamingWorkflow,
    parentChildWorkflow
  )
  
  // initialize runtime api
  initializeRuntime(world)
  
  // start the world
  await world.start()
  console.log('world started')
  console.log()
  
  // example 1: basic order workflow with compensation
  console.log('--- example 1: order workflow with compensation ---')
  const orderHandle = await start('order-workflow', {
    userId: 'user-123',
    items: ['item-a', 'item-b'],
    email: 'user@example.com'
  }, {
    workflowId: 'order-demo-1'
  })
  console.log(`order workflow started: ${orderHandle.workflowId}`)
  
  // wait for result
  try {
    const orderResult = await orderHandle.result()
    console.log(`order workflow completed: ${JSON.stringify(orderResult)}`)
  } catch (err) {
    console.error(`order workflow failed: ${err}`)
  }
  console.log()
  
  // example 2: scheduled workflow
  console.log('--- example 2: scheduled recurring workflow ---')
  await world.schedule(
    'daily-report',
    'scheduled-report',
    { reportType: 'daily-sales' },
    '0 9 * * *' // 9am daily
  )
  console.log('scheduled daily report at 9am')
  console.log()
  
  // example 3: hook based workflow
  console.log('--- example 3: workflow with hook ---')
  const hookHandle = await start('hook-demo', {
    userId: 'user-456'
  }, {
    workflowId: 'hook-demo-1'
  })
  console.log(`hook workflow started: ${hookHandle.workflowId}`)
  
  // simulate external approval after 2 seconds
  setTimeout(async () => {
    console.log('simulating external approval...')
    const runState = await getRun(hookHandle.workflowId)
    
    if (runState.hooks && runState.hooks.length > 0) {
      const hook = runState.hooks[0]
      await resumeHook(hook.token, {
        approved: true,
        approver: 'admin-user'
      })
      console.log('approval sent to hook')
    }
  }, 2000)
  
  try {
    const hookResult = await hookHandle.result()
    console.log(`hook workflow completed: ${JSON.stringify(hookResult)}`)
  } catch (err) {
    console.error(`hook workflow failed: ${err}`)
  }
  console.log()
  
  // example 4: parent child workflows
  console.log('--- example 4: parent child workflows ---')
  const parentHandle = await start('parent-child', {
    tasks: ['report-a', 'report-b', 'report-c']
  })
  console.log(`parent workflow started: ${parentHandle.workflowId}`)
  
  const parentResult = await parentHandle.result()
  console.log(`parent workflow completed with ${parentResult.childResults.length} children`)
  console.log()
  
  // example 5: query workflow state
  console.log('--- example 5: query workflow state ---')
  const state = await getRun(orderHandle.workflowId)
  console.log(`workflow ${state.workflowId} status: ${state.status}`)
  console.log(`activities executed: ${state.activities.length}`)
  console.log(`history events: ${state.history.length}`)
  console.log()
  
  // example 6: query multiple workflows
  console.log('--- example 6: query workflows ---')
  const completedWorkflows = await world.queryWorkflows({
    status: 'completed',
    limit: 5
  })
  console.log(`found ${completedWorkflows.length} completed workflows`)
  console.log()
  
  console.log('all examples completed')
  console.log('shutting down world...')
  
  await world.shutdown()
  console.log('done')
}

// run examples
main().catch(console.error)
