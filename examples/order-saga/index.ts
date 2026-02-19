/**
 * order saga example
 * 
 * demonstrates the saga pattern for e-commerce order processing with compensation logic.
 */

import { World, workflow, activity } from '../../src/index'

// activities for order processing
const chargeCard = activity('charge-card', async (ctx, { amount, cardToken }) => {
  console.log(`charging card: $${amount}`)
  ctx.heartbeat('processing payment')
  
  await sleep(500)
  
  const transactionId = `txn_${Date.now()}`
  console.log(`payment successful: ${transactionId}`)
  
  return { transactionId, amount, charged: true }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const refundCard = activity('refund-card', async (ctx, { transactionId, amount }) => {
  console.log(`refunding transaction: ${transactionId} ($${amount})`)
  await sleep(500)
  console.log(`refund successful`)
  return { refunded: true }
})

const reserveInventory = activity('reserve-inventory', async (ctx, { items }) => {
  console.log(`reserving inventory for ${items.length} items`)
  ctx.heartbeat('checking stock')
  
  await sleep(300)
  
  const reservationId = `res_${Date.now()}`
  console.log(`inventory reserved: ${reservationId}`)
  
  return { reservationId, items }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' }
})

const releaseInventory = activity('release-inventory', async (ctx, { reservationId }) => {
  console.log(`releasing inventory reservation: ${reservationId}`)
  await sleep(300)
  console.log(`inventory released`)
  return { released: true }
})

const createShipment = activity('create-shipment', async (ctx, { orderId, address }) => {
  console.log(`creating shipment for order: ${orderId}`)
  ctx.heartbeat('preparing shipment')
  
  await sleep(500)
  
  // simulate random failure for demo purposes
  if (Math.random() < 0.3) {
    throw new Error('shipment provider unavailable')
  }
  
  const trackingNumber = `TRK${Date.now()}`
  console.log(`shipment created: ${trackingNumber}`)
  
  return { trackingNumber }
}, {
  retry: { maxAttempts: 2, backoff: 'exponential' }
})

const cancelShipment = activity('cancel-shipment', async (ctx, { trackingNumber }) => {
  console.log(`cancelling shipment: ${trackingNumber}`)
  await sleep(300)
  console.log(`shipment cancelled`)
  return { cancelled: true }
})

const sendOrderConfirmation = activity('send-confirmation', async (ctx, { email, orderId }) => {
  console.log(`sending confirmation email to ${email}`)
  await sleep(200)
  console.log(`confirmation sent`)
  return { sent: true }
})

// order workflow with saga pattern
const orderSaga = workflow('order-saga', async (ctx, order) => {
  console.log(`\nstarting order workflow: ${order.orderId}`)
  
  // step 1: charge the card
  const payment = await ctx.run(chargeCard, {
    amount: order.total,
    cardToken: order.cardToken
  })
  
  // add compensation to refund if later steps fail
  ctx.addCompensation(() => 
    ctx.run(refundCard, {
      transactionId: payment.transactionId,
      amount: payment.amount
    })
  )
  
  // step 2: reserve inventory
  const reservation = await ctx.run(reserveInventory, {
    items: order.items
  })
  
  // add compensation to release inventory
  ctx.addCompensation(() => 
    ctx.run(releaseInventory, {
      reservationId: reservation.reservationId
    })
  )
  
  // step 3: create shipment (might fail)
  const shipment = await ctx.run(createShipment, {
    orderId: order.orderId,
    address: order.shippingAddress
  })
  
  // add compensation to cancel shipment
  ctx.addCompensation(() => 
    ctx.run(cancelShipment, {
      trackingNumber: shipment.trackingNumber
    })
  )
  
  // step 4: send confirmation (no compensation needed)
  await ctx.run(sendOrderConfirmation, {
    email: order.email,
    orderId: order.orderId
  })
  
  console.log(`order completed successfully: ${order.orderId}`)
  
  return {
    orderId: order.orderId,
    transactionId: payment.transactionId,
    trackingNumber: shipment.trackingNumber,
    status: 'completed'
  }
}, {
  failureStrategy: 'compensate'
})

// setup and run
const world = new World({
  minWorkers: 2,
  maxWorkers: 4,
  persistence: 'memory'
})

world.register(
  orderSaga,
  chargeCard,
  refundCard,
  reserveInventory,
  releaseInventory,
  createShipment,
  cancelShipment,
  sendOrderConfirmation
)

await world.start()

// process multiple orders to see some succeed and some fail (and compensate)
console.log('processing 5 orders...\n')

for (let i = 1; i <= 5; i++) {
  const order = {
    orderId: `order-${i}`,
    email: `customer${i}@example.com`,
    total: 99.99,
    cardToken: 'tok_visa_4242',
    items: [
      { sku: 'WIDGET-A', quantity: 2 },
      { sku: 'GADGET-B', quantity: 1 }
    ],
    shippingAddress: {
      street: '123 Main St',
      city: 'Springfield',
      zip: '12345'
    }
  }
  
  try {
    const handle = await world.execute('order-saga', order)
    
    // wait a bit to see the result
    setTimeout(async () => {
      const state = await handle.query()
      console.log(`\norder ${order.orderId} final status: ${state.status}`)
      if (state.status === 'compensated') {
        console.log('  compensations were executed')
      }
    }, 3000)
  } catch (err) {
    console.error(`error starting order ${order.orderId}:`, err)
  }
  
  await sleep(100)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// keep running for a bit to see results
setTimeout(async () => {
  const metrics = world.getMetrics()
  console.log('\n--- final metrics ---')
  console.log(`completed: ${metrics.workflows.completed}`)
  console.log(`failed: ${metrics.workflows.failed}`)
  
  await world.shutdown()
  process.exit(0)
}, 10000)
