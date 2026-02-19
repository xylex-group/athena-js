# failure strategies

other things can fail. networks timeout, services go down, athena-js brings better ways to handle failures depending on what makes sense for your use case.

## the strategies

### compensate

runs compensation logic (saga pattern) to undo what was done. use this for long-running transactions where you need to clean up after failures.

```typescript
const orderFlow = workflow('order', async (ctx, order) => {
  // charge card
  const payment = await ctx.run(chargeCard, { 
    amount: order.total,
    card: order.card 
  })
  ctx.addCompensation(() => ctx.run(refundCard, { 
    paymentId: payment.id 
  }))
  
  // reserve inventory
  const reservation = await ctx.run(reserveInventory, { 
    items: order.items 
  })
  ctx.addCompensation(() => ctx.run(releaseInventory, { 
    reservationId: reservation.id 
  }))
  
  // create shipment (if this fails, compensations run)
  await ctx.run(createShipment, { orderId: order.id })
  
  return { success: true }
}, { 
  failureStrategy: 'compensate' 
})
```

compensations run in reverse order (LIFO). if `createShipment` fails, first `releaseInventory` runs, then `refundCard`.

### retry

just retry the whole workflow. simple and effective for transient failures.

```typescript
const fetchData = workflow('fetch', async (ctx, { url }) => {
  const data = await ctx.run(httpGet, { url })
  await ctx.run(saveToDb, { data })
  return { success: true }
}, { 
  failureStrategy: 'retry' 
})
```

the workflow restarts from the beginning. activities that already completed are replayed from their recorded results (determinism).

### cascade

fail the parent workflow and all children. use when a failure means everything should stop.

```typescript
const parentFlow = workflow('parent', async (ctx, data) => {
  const children = await Promise.all([
    ctx.executeChild('child-1', data.part1),
    ctx.executeChild('child-2', data.part2),
  ])
  
  // if any child fails, parent and all children fail
  await Promise.all(children.map(c => c.result()))
}, { 
  failureStrategy: 'cascade' 
})
```

### ignore

mark as failed and move on. use when failures are acceptable or handled elsewhere.

```typescript
const sendNotification = workflow('notify', async (ctx, { userId }) => {
  await ctx.run(sendPush, { userId })
  await ctx.run(sendEmail, { userId })
}, { 
  failureStrategy: 'ignore' 
})
```

if it fails, it fails. the world keeps turning.

### quarantine

isolate the failed workflow for debugging. doesnt retry or compensate, just marks it failed and leaves it for you to inspect.

```typescript
const debuggableFlow = workflow('debug', async (ctx, data) => {
  // complex logic that might fail
  await ctx.run(complexActivity, data)
}, { 
  failureStrategy: 'quarantine' 
})
```

useful during development or for workflows with weird failures you want to investigate.

## saga pattern deep dive

the saga pattern is all about compensation. for each step that changes state, you register a compensation function that undoes it.

### basic saga

```typescript
const bookTrip = workflow('book-trip', async (ctx, trip) => {
  // book flight
  const flight = await ctx.run(bookFlight, trip.flight)
  ctx.addCompensation(async () => {
    await ctx.run(cancelFlight, { bookingId: flight.bookingId })
  })
  
  // book hotel
  const hotel = await ctx.run(bookHotel, trip.hotel)
  ctx.addCompensation(async () => {
    await ctx.run(cancelHotel, { reservationId: hotel.reservationId })
  })
  
  // book car
  const car = await ctx.run(bookCar, trip.car)
  ctx.addCompensation(async () => {
    await ctx.run(cancelCar, { rentalId: car.rentalId })
  })
  
  return { trip: { flight, hotel, car } }
}, { 
  failureStrategy: 'compensate' 
})
```

if `bookCar` fails:

1. `cancelHotel` runs
2. `cancelFlight` runs
3. workflow ends in 'compensated' state

### saga with data dependencies

compensations can access data from the forward steps:

```typescript
const processOrder = workflow('order', async (ctx, order) => {
  const validated = await ctx.run(validateOrder, order)
  
  const payment = await ctx.run(processPayment, {
    amount: validated.total,
    customerId: validated.customerId
  })
  
  ctx.addCompensation(async () => {
    await ctx.run(refundPayment, {
      paymentId: payment.transactionId,
      amount: payment.amount,
      reason: 'order_failed'
    })
  })
  
  // rest of order processing
})
```

### conditional compensations

you can decide whether to compensate based on what failed:

```typescript
const smartSaga = workflow('smart', async (ctx, data) => {
  const step1 = await ctx.run(activity1, data)
  let compensate1 = false
  
  ctx.addCompensation(async () => {
    if (compensate1) {
      await ctx.run(undo1, step1)
    }
  })
  
  try {
    await ctx.run(activity2, data)
    compensate1 = true
  } catch (err) {
    // dont compensate step1 if step2 failed in a certain way
    if (err.message.includes('temporary')) {
      compensate1 = false
    }
    throw err
  }
})
```

### partial compensations

sometimes compensations can fail too:

```typescript
const robustSaga = workflow('robust', async (ctx, data) => {
  const step1 = await ctx.run(doSomething, data)
  
  ctx.addCompensation(async () => {
    try {
      await ctx.run(undoSomething, step1)
    } catch (err) {
      // log but dont fail the compensation
      console.error('compensation failed:', err)
      // maybe send alert, but keep going with other compensations
    }
  })
})
```

athena-js tries to run all compensations even if some fail. you can check compensation state:

```typescript
const state = await world.query(workflowId)

for (const comp of state.compensations) {
  console.log(comp.id)
  console.log(comp.executed)  // true if it ran
  console.log(comp.error)     // error if it failed
}
```

## combining strategies

you can use different strategies at different levels:

```typescript
// parent uses cascade
const parent = workflow('parent', async (ctx, data) => {
  const child1 = await ctx.executeChild('child1', data.part1)
  const child2 = await ctx.executeChild('child2', data.part2)
  
  await Promise.all([child1.result(), child2.result()])
}, { failureStrategy: 'cascade' })

// child uses compensate
const child = workflow('child', async (ctx, data) => {
  const step1 = await ctx.run(activity1, data)
  ctx.addCompensation(() => ctx.run(undo1, step1))
  
  const step2 = await ctx.run(activity2, data)
  ctx.addCompensation(() => ctx.run(undo2, step2))
}, { failureStrategy: 'compensate' })
```

if a child fails:

1. child runs its compensations
2. parent cascade kicks in
3. other children are cancelled

## retry with backoff at workflow level

workflows can retry themselves with backoff:

```typescript
const retryableFlow = workflow('retry', async (ctx, data) => {
  // this whole workflow retries if it fails
  await ctx.run(fragileActivity, data)
}, { 
  failureStrategy: 'retry',
  // workflow will be retried up to 3 times
})
```

the workflow executor tracks retry attempts and gives up after `maxAttempts` (configurable per workflow).

## manual failure handling

you can also handle failures manually in the workflow:

```typescript
const manualHandling = workflow('manual', async (ctx, data) => {
  try {
    await ctx.run(riskyActivity, data)
  } catch (err) {
    // decide what to do based on error
    if (err.message.includes('rate_limit')) {
      await ctx.sleep(60000)  // wait and retry
      await ctx.run(riskyActivity, data)
    } else if (err.message.includes('invalid')) {
      // cant recover, but dont fail the workflow
      return { success: false, reason: 'invalid_data' }
    } else {
      // unknown error, fail the workflow
      throw err
    }
  }
})
```

## monitoring failures

query failed workflows:

```typescript
const failed = await world.queryWorkflows({
  status: 'failed',
  limit: 10
})

for (const workflow of failed) {
  console.log(workflow.workflowId)
  console.log(workflow.error)
  console.log(workflow.history)  // see what happened
}
```

query compensated workflows:

```typescript
const compensated = await world.queryWorkflows({
  status: 'compensated',
  limit: 10
})
```

## best practices

1. **use compensate for distributed transactions** - when you need to undo things across services
2. **use retry for transient failures** - network blips, temporary unavailability
3. **use cascade for atomic operations** - when partial success is worse than complete failure
4. **use ignore for non-critical paths** - notifications, analytics, etc
5. **use quarantine during debugging** - to inspect weird failures
6. **keep compensations simple** - they should be reliable
7. **make compensations idempotent** - they might run multiple times
8. **log compensation failures** - theyre worth investigating

## example: e-commerce checkout

putting it all together:

```typescript
const checkout = workflow('checkout', async (ctx, cart) => {
  // validate cart
  const validated = await ctx.run(validateCart, cart)
  
  // charge payment
  const payment = await ctx.run(chargeCard, {
    amount: validated.total,
    card: cart.paymentMethod
  })
  ctx.addCompensation(() => 
    ctx.run(refundCard, { transactionId: payment.id })
  )
  
  // reserve inventory
  const reservation = await ctx.run(reserveItems, {
    items: validated.items
  })
  ctx.addCompensation(() => 
    ctx.run(releaseItems, { reservationId: reservation.id })
  )
  
  // create order
  const order = await ctx.run(createOrder, {
    userId: cart.userId,
    items: validated.items,
    paymentId: payment.id
  })
  
  // send confirmation (dont compensate this)
  await ctx.run(sendOrderConfirmation, {
    email: cart.email,
    orderId: order.id
  })
  
  return { orderId: order.id, success: true }
}, { 
  failureStrategy: 'compensate' 
})
```

if anything fails after charging the card, compensations run automatically to clean up.

## next steps

check out the examples:

- `examples/order-saga/` - full e-commerce saga
- `examples/failure-scenarios/` - different failure modes

and read the other docs:

- [workflows.md](./workflows.md) - workflow patterns
- [activities.md](./activities.md) - activity best practices
