/**
 * basic workflow example
 * 
 * the simplest possible workflow. good starting point for learning worlds-engine.
 */

import { World, workflow, activity } from '../../src/index'

// simple activity that just logs and returns
const greet = activity('greet', async (ctx, { name }) => {
  console.log(`hello, ${name}`)
  return { greeted: true }
})

// simple workflow that runs one activity
const simpleFlow = workflow('simple', async (ctx, { name }) => {
  const result = await ctx.run(greet, { name })
  return { success: true, ...result }
})

// create and start the world
const world = new World({
  minWorkers: 1,
  maxWorkers: 2,
  persistence: 'memory'
})

world.register(simpleFlow, greet)

await world.start()

// execute the workflow
const handle = await world.execute('simple', { name: 'world' })

console.log('workflow started:', handle.workflowId)

// wait for result
const result = await handle.result()

console.log('workflow completed:', result)

// cleanup
await world.shutdown()
