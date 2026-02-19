/**
 * express api example
 * 
 * shows how to integrate athena-js with an express api for job queue functionality.
 */

import express from 'express'
import { World, workflow, activity } from '../../src/index'

// activity that simulates image processing
const processImage = activity('process-image', async (ctx, { url }) => {
  ctx.heartbeat('downloading')
  await sleep(1000)
  
  ctx.heartbeat('resizing')
  await sleep(1000)
  
  ctx.heartbeat('uploading')
  await sleep(1000)
  
  return { 
    processedUrl: url.replace('.jpg', '-processed.jpg'),
    timestamp: Date.now()
  }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' },
  timeout: '30s'
})

// workflow that processes multiple images
const imageWorkflow = workflow('image-pipeline', async (ctx, { urls }) => {
  const results = await Promise.all(
    urls.map(url => ctx.run(processImage, { url }))
  )
  
  return { 
    processed: results.length,
    urls: results.map(r => r.processedUrl)
  }
})

// setup world
const world = new World({
  minWorkers: 2,
  maxWorkers: 8,
  persistence: 'hybrid'
})

world.register(imageWorkflow, processImage)

// setup express
const app = express()
app.use(express.json())

// endpoint to start image processing
app.post('/api/process', async (req, res) => {
  try {
    const { urls } = req.body
    
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'urls array required' })
    }
    
    const handle = await world.execute('image-pipeline', { urls })
    
    res.json({ 
      workflowId: handle.workflowId,
      status: 'queued'
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// endpoint to check workflow status
app.get('/api/process/:id', async (req, res) => {
  try {
    const state = await world.query(req.params.id)
    
    res.json({
      workflowId: state.workflowId,
      status: state.status,
      result: state.result,
      error: state.error,
      startedAt: state.startedAt,
      completedAt: state.completedAt
    })
  } catch (err) {
    res.status(404).json({ error: 'workflow not found' })
  }
})

// endpoint to get world metrics
app.get('/api/metrics', (req, res) => {
  const metrics = world.getMetrics()
  res.json(metrics)
})

// start everything
await world.start()

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`)
  console.log(`POST /api/process - start image processing`)
  console.log(`GET /api/process/:id - check status`)
  console.log(`GET /api/metrics - world metrics`)
})

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
