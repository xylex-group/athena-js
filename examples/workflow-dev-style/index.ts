/**
 * workflow dev style example
 * 
 * demonstrates athena-js features matching workflow.dev sdk capabilities
 * simple declarative api for defining and using workflows with sleep delays
 * retry logic error handling and durable execution
 */

import { World, workflow, activity } from '../../src/index'

// activities similar to workflow.dev functions

const createUser = activity('create-user', async (ctx, { email, name }) => {
  ctx.heartbeat('creating user account')
  
  const userId = `user-${Date.now()}`
  
  // simulate database operation
  console.log(`  created user ${userId} for ${email}`)
  
  return {
    userId,
    email,
    name,
    createdAt: Date.now()
  }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const sendWelcomeEmail = activity('send-welcome-email', async (ctx, { email, name, userId }) => {
  ctx.heartbeat(`sending welcome email to ${email}`)
  
  // simulate email service call
  console.log(`  sent welcome email to ${email}`)
  
  return {
    sent: true,
    sentAt: Date.now(),
    messageId: `msg-${Date.now()}`
  }
}, {
  retry: { maxAttempts: 5, backoff: 'exponential' }
})

const sendOneWeekCheckIn = activity('send-check-in', async (ctx, { email, name, userId }) => {
  ctx.heartbeat(`sending check-in email to ${email}`)
  
  // simulate email service call
  console.log(`  sent one week check-in email to ${email}`)
  
  return {
    sent: true,
    sentAt: Date.now(),
    messageId: `msg-${Date.now()}`
  }
}, {
  retry: { maxAttempts: 5, backoff: 'exponential' }
})

// simple declarative workflow like workflow.dev
const onboardUserWorkflow = workflow('onboard-user', async (ctx, { email, name }) => {
  console.log(`\nstarting onboarding for ${email}`)
  
  // create user account
  const user = await ctx.run(createUser, { email, name })
  
  // send welcome email immediately
  await ctx.run(sendWelcomeEmail, {
    email: user.email,
    name: user.name,
    userId: user.userId
  })
  
  // sleep for one week like workflow.dev sleep function
  console.log(`  sleeping for 7 days simulated as 3 seconds`)
  await ctx.sleep(3000) // simulating 7 days as 3 seconds for demo
  
  // send check-in email after one week
  await ctx.run(sendOneWeekCheckIn, {
    email: user.email,
    name: user.name,
    userId: user.userId
  })
  
  return {
    userId: user.userId,
    email: user.email,
    onboardingComplete: true
  }
})

// workflow with parallel execution
const parallelProcessingWorkflow = workflow('parallel-processing', async (ctx, { items }) => {
  console.log(`\nprocessing ${items.length} items in parallel`)
  
  // process all items in parallel
  const results = await Promise.all(
    items.map(item => ctx.run(processItem, item))
  )
  
  return {
    processed: results.length,
    results
  }
})

const processItem = activity('process-item', async (ctx, item) => {
  ctx.heartbeat(`processing ${item.id}`)
  
  // simulate processing
  console.log(`  processed item ${item.id}`)
  
  return {
    itemId: item.id,
    processed: true,
    processedAt: Date.now()
  }
})

// workflow with conditional logic
const conditionalWorkflow = workflow('conditional', async (ctx, { orderAmount, customerTier }) => {
  console.log(`\nprocessing order $${orderAmount} for ${customerTier} customer`)
  
  // conditional execution based on input
  if (orderAmount > 1000) {
    console.log('  large order requires manual review')
    await ctx.run(requestManualReview, { orderAmount })
  }
  
  if (customerTier === 'premium') {
    console.log('  premium customer gets priority processing')
    await ctx.run(priorityProcessing, { orderAmount })
  } else {
    await ctx.run(standardProcessing, { orderAmount })
  }
  
  return { processed: true }
})

const requestManualReview = activity('manual-review', async (ctx, { orderAmount }) => {
  console.log(`  manual review requested for $${orderAmount}`)
  return { reviewed: true }
})

const priorityProcessing = activity('priority-processing', async (ctx, { orderAmount }) => {
  console.log(`  priority processing for $${orderAmount}`)
  return { priority: true }
})

const standardProcessing = activity('standard-processing', async (ctx, { orderAmount }) => {
  console.log(`  standard processing for $${orderAmount}`)
  return { priority: false }
})

// workflow with error handling and retry
const resilientWorkflow = workflow('resilient', async (ctx, { data }) => {
  console.log(`\nprocessing resilient workflow`)
  
  try {
    // attempt risky operation with automatic retry
    const result = await ctx.run(riskyOperation, { data })
    return { success: true, result }
  } catch (error) {
    // handle failure gracefully
    console.log(`  operation failed sending notification`)
    await ctx.run(sendFailureNotification, { error: error.message })
    throw error
  }
})

let riskyAttempts = 0
const riskyOperation = activity('risky-operation', async (ctx, { data }) => {
  riskyAttempts++
  ctx.heartbeat(`attempt ${riskyAttempts}`)
  
  // fail first 2 attempts to demonstrate retry
  if (riskyAttempts <= 2) {
    throw new Error('temporary failure')
  }
  
  console.log(`  risky operation succeeded on attempt ${riskyAttempts}`)
  return { processed: true }
}, {
  retry: { maxAttempts: 5, backoff: 'exponential' }
})

const sendFailureNotification = activity('failure-notification', async (ctx, { error }) => {
  console.log(`  sent failure notification ${error}`)
  return { sent: true }
})

// workflow with child workflows
const orchestrationWorkflow = workflow('orchestration', async (ctx, { projectId }) => {
  console.log(`\nstarting project orchestration ${projectId}`)
  
  // spawn child workflows for different phases
  const setupPhase = await ctx.executeChild('setup-phase', { projectId })
  const setupResult = await setupPhase.result()
  
  const buildPhase = await ctx.executeChild('build-phase', {
    projectId,
    setupData: setupResult
  })
  const buildResult = await buildPhase.result()
  
  const deployPhase = await ctx.executeChild('deploy-phase', {
    projectId,
    buildData: buildResult
  })
  const deployResult = await deployPhase.result()
  
  return {
    projectId,
    setupComplete: setupResult.complete,
    buildComplete: buildResult.complete,
    deployComplete: deployResult.complete
  }
})

const setupPhase = workflow('setup-phase', async (ctx, { projectId }) => {
  console.log(`  setup phase for ${projectId}`)
  await ctx.sleep(100)
  return { complete: true, phase: 'setup' }
})

const buildPhase = workflow('build-phase', async (ctx, { projectId, setupData }) => {
  console.log(`  build phase for ${projectId}`)
  await ctx.sleep(100)
  return { complete: true, phase: 'build' }
})

const deployPhase = workflow('deploy-phase', async (ctx, { projectId, buildData }) => {
  console.log(`  deploy phase for ${projectId}`)
  await ctx.sleep(100)
  return { complete: true, phase: 'deploy' }
})

// workflow with scheduling
const scheduledReportWorkflow = workflow('scheduled-report', async (ctx, { reportType, recipients }) => {
  console.log(`\ngenerating ${reportType} report`)
  
  // generate report data
  const reportData = await ctx.run(generateReport, { reportType })
  
  // send to all recipients
  await Promise.all(
    recipients.map(email =>
      ctx.run(sendReportEmail, { email, reportData })
    )
  )
  
  return {
    reportType,
    generated: true,
    sentTo: recipients.length
  }
})

const generateReport = activity('generate-report', async (ctx, { reportType }) => {
  ctx.heartbeat('generating report')
  console.log(`  generated ${reportType} report`)
  return {
    reportType,
    data: { records: 100, summary: 'report data' },
    generatedAt: Date.now()
  }
})

const sendReportEmail = activity('send-report-email', async (ctx, { email, reportData }) => {
  ctx.heartbeat(`sending to ${email}`)
  console.log(`  sent report to ${email}`)
  return { sent: true }
})

// setup and run examples
async function main() {
  const world = new World({
    minWorkers: 2,
    maxWorkers: 6,
    persistence: 'memory'
  })
  
  // register all workflows and activities
  world.register(
    onboardUserWorkflow,
    parallelProcessingWorkflow,
    conditionalWorkflow,
    resilientWorkflow,
    orchestrationWorkflow,
    scheduledReportWorkflow,
    setupPhase,
    buildPhase,
    deployPhase,
    createUser,
    sendWelcomeEmail,
    sendOneWeekCheckIn,
    processItem,
    requestManualReview,
    priorityProcessing,
    standardProcessing,
    riskyOperation,
    sendFailureNotification,
    generateReport,
    sendReportEmail
  )
  
  await world.start()
  
  console.log('=== athena-js workflow.dev style examples ===\n')
  
  // example 1 simple onboarding workflow with sleep
  console.log('1. onboarding workflow with delayed check-in')
  const onboarding = await world.execute('onboard-user', {
    email: 'user@example.com',
    name: 'test user'
  })
  await onboarding.result()
  
  // example 2 parallel processing
  console.log('\n2. parallel processing workflow')
  const parallel = await world.execute('parallel-processing', {
    items: [
      { id: 'item-1', data: 'data1' },
      { id: 'item-2', data: 'data2' },
      { id: 'item-3', data: 'data3' }
    ]
  })
  await parallel.result()
  
  // example 3 conditional logic
  console.log('\n3. conditional workflow')
  const conditional1 = await world.execute('conditional', {
    orderAmount: 1500,
    customerTier: 'premium'
  })
  await conditional1.result()
  
  const conditional2 = await world.execute('conditional', {
    orderAmount: 50,
    customerTier: 'standard'
  })
  await conditional2.result()
  
  // example 4 resilient workflow with retry
  console.log('\n4. resilient workflow with automatic retry')
  riskyAttempts = 0
  const resilient = await world.execute('resilient', {
    data: { value: 123 }
  })
  await resilient.result()
  
  // example 5 orchestration with child workflows
  console.log('\n5. orchestration with child workflows')
  const orchestration = await world.execute('orchestration', {
    projectId: 'proj-123'
  })
  await orchestration.result()
  
  // example 6 scheduled workflow
  console.log('\n6. scheduling daily report workflow')
  await world.schedule(
    'daily-report',
    'scheduled-report',
    () => ({
      reportType: 'daily-summary',
      recipients: ['admin@example.com', 'manager@example.com']
    }),
    '0 9 * * *' // every day at 9am
  )
  
  // execute once for demonstration
  const report = await world.execute('scheduled-report', {
    reportType: 'daily-summary',
    recipients: ['admin@example.com']
  })
  await report.result()
  
  // show metrics
  console.log('\n=== world metrics ===')
  const metrics = world.getMetrics()
  console.log(`workflows completed ${metrics.workflows.completed}`)
  console.log(`workflows failed ${metrics.workflows.failed}`)
  console.log(`workers ${metrics.workers.total}`)
  
  await world.shutdown()
  console.log('\nexamples completed')
}

main().catch(console.error)
