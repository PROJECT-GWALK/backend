import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import userinfoRoute from './routes/userinfo.js'
import userManagement from './routes/usermanagement.js'
import adminDashboard from './routes/admindashboard.js'
import filesRoute from './routes/files.js'
import eventRoute from './routes/event.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

//////////////////////////////////////////////////////////
// USER
//////////////////////////////////////////////////////////
app.route("/files", filesRoute);
app.route("/api/user/@me", userinfoRoute);
app.route("/api/events", eventRoute)


//////////////////////////////////////////////////////////
// ADMIN
//////////////////////////////////////////////////////////
app.route("api/usermanagement", userManagement)
app.route("api/admindashboard", adminDashboard)

serve({
  fetch: app.fetch,
  port: 3001
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})