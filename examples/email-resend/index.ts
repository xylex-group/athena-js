import { World, workflow, activity } from '../../src/index'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY || 're_demo_key')

const sendEmail = activity('send-email', async (ctx, { to, subject, html }) => {
  ctx.heartbeat('sending email')
  
  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 're_demo_key') {
    console.log(`[DEMO] would send email to ${to}`)
    console.log(`  subject: ${subject}`)
    await sleep(500)
    return { 
      messageId: `msg_${Date.now()}`,
      sent: true 
    }
  }
  
  const { data, error } = await resend.emails.send({
    from: 'onboarding@resend.dev',
    to,
    subject,
    html
  })
  
  if (error) {
    throw new Error(`failed to send email: ${error.message}`)
  }
  
  console.log(`email sent: ${data?.id}`)
  return { messageId: data?.id, sent: true }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const emailWorkflow = workflow('email-workflow', async (ctx, { email, name, notifications }) => {
  console.log(`starting email workflow for ${email}`)
  
  await ctx.run(sendEmail, {
    to: email,
    subject: `welcome ${name}!`,
    html: `<h1>welcome ${name}!</h1><p>thanks for joining us.</p>`
  })
  
  if (notifications && notifications.length > 0) {
    await Promise.all(
      notifications.map(msg => 
        ctx.run(sendEmail, { 
          to: email, 
          subject: 'notification',
          html: `<p>${msg}</p>`
        })
      )
    )
  }
  
  return { completed: true, email }
})

const world = new World({
  minWorkers: 1,
  maxWorkers: 3,
  persistence: 'memory'
})

world.register(emailWorkflow, sendEmail)

await world.start()

console.log('email workflow example')
console.log('set RESEND_API_KEY environment variable to send real emails\n')

const handle = await world.execute('email-workflow', {
  email: 'user@example.com',
  name: 'john doe',
  notifications: [
    'your account has been created',
    'please verify your email address'
  ]
})

console.log(`workflow started: ${handle.workflowId}`)

const result = await handle.result()
console.log('workflow completed:', result)

await world.shutdown()

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

