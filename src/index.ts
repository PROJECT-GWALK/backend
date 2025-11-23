import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import userinfoRoute from './routes/userinfo.js'
import userManagement from './routes/usermanagement.js'
import adminDashboard from './routes/admindashboard.js'
import filesRoute from './routes/files.js'
import eventRoute from './routes/event.js'
import { swaggerUI } from '@hono/swagger-ui'
import { openApiDoc } from './swingger/ApiDoc.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

//////////////////////////////////////////////////////////
// BUCKET FILES
//////////////////////////////////////////////////////////
app.route("/files", filesRoute);

//////////////////////////////////////////////////////////
// USER
//////////////////////////////////////////////////////////
app.route("/api/user/@me", userinfoRoute);
app.route("/api/events", eventRoute)


//////////////////////////////////////////////////////////
// ADMIN
//////////////////////////////////////////////////////////
app.route("api/usermanagement", userManagement)
app.route("api/admindashboard", adminDashboard)

//////////////////////////////////////////////////////////
// SWAGGER UI
//////////////////////////////////////////////////////////
app.get('/openapi.json', (c) => {
  return c.json(openApiDoc)
})
app.get('/apiDoc', swaggerUI({
  url: '/openapi.json'
}))

serve({
  fetch: app.fetch,
  port: 3001
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})