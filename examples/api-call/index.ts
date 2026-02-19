import { World, workflow, activity } from '../../src/index'

const callApi = activity('call-api', async (ctx, { url, method = 'GET', body, headers = {} }) => {
  ctx.heartbeat(`calling ${method} ${url}`)
  
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  }
  
  if (body) {
    options.body = JSON.stringify(body)
  }
  
  const response = await fetch(url, options)
  
  if (!response.ok) {
    throw new Error(`api call failed: ${response.status} ${response.statusText}`)
  }
  
  const data = await response.json()
  console.log(`api call successful: ${url}`)
  
  return { data, status: response.status }
}, {
  retry: { maxAttempts: 3, backoff: 'exponential' },
  timeout: '30s'
})

const apiWorkflow = workflow('api-workflow', async (ctx, { userId, postTitle, postBody, userUpdates }) => {
  console.log(`starting api workflow for user ${userId}`)
  
  const user = await ctx.run(callApi, {
    url: `https://jsonplaceholder.typicode.com/users/${userId}`,
    method: 'GET'
  })
  console.log(`fetched user: ${user.data.name}`)
  
  const post = await ctx.run(callApi, {
    url: 'https://jsonplaceholder.typicode.com/posts',
    method: 'POST',
    body: { userId, title: postTitle, body: postBody }
  })
  console.log(`created post: ${post.data.id}`)
  
  if (userUpdates) {
    const updated = await ctx.run(callApi, {
      url: `https://jsonplaceholder.typicode.com/users/${userId}`,
      method: 'PATCH',
      body: userUpdates
    })
    console.log(`updated user: ${updated.data.name}`)
  }
  
  return {
    userId,
    userName: user.data.name,
    postId: post.data.id,
    completed: true
  }
})

const world = new World({
  minWorkers: 2,
  maxWorkers: 5,
  persistence: 'memory'
})

world.register(apiWorkflow, callApi)

await world.start()

console.log('api call workflow example\n')

const handle = await world.execute('api-workflow', {
  userId: 1,
  postTitle: 'hello world',
  postBody: 'this is a test post',
  userUpdates: { phone: '555-1234' }
})

console.log(`workflow started: ${handle.workflowId}`)

const result = await handle.result()
console.log('\nworkflow completed:', result)

await world.shutdown()

