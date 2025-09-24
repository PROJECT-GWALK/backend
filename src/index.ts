import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import userinfoRoute from './routes/userinfo.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route("/api/user/@me", userinfoRoute);

serve({
  fetch: app.fetch,
  port: 3001
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})