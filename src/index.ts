import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import protectedRoute from './routes/userinfo.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route("/api/user/@me", protectedRoute);

serve({
  fetch: app.fetch,
  port: 3001
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
