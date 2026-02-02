import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import userManagement from './routes/usermanagement.js'
import adminDashboard from './routes/admindashboard.js'
import filesRoute from './routes/files.js'
import eventsRoute from './routes/events.js'
import { swaggerUI } from '@hono/swagger-ui'
import { openApiDoc } from './swingger/ApiDoc.js'
import { userRoute, userProfileRoute } from './routes/userinfo.js'

const app = new Hono()

//////////////////////////////////////////////////////////
// SWAGGER UI
//////////////////////////////////////////////////////////
app.get('/openapi.json', (c) => {
  return c.json(openApiDoc)
})
app.get('/', swaggerUI({
  url: '/openapi.json'
}))

//////////////////////////////////////////////////////////
// BUCKET FILES
//////////////////////////////////////////////////////////
app.route("/files", filesRoute);

//////////////////////////////////////////////////////////
// USER
//////////////////////////////////////////////////////////
app.route("/api/user/@me", userRoute);
app.route("/api/user", userProfileRoute);
app.route("/api/events", eventsRoute)


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
