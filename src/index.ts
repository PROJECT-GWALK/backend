import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import userinfoRoute from './routes/userinfo.js'
import userManagement from './routes/usermanagement.js'
import adminDashboard from './routes/admindashboard.js'
import filesRoute from './routes/files.js'
import draftRoute from './routes/event/draft.js'
import publicRoute from './routes/event/public.js'
import { swaggerUI } from '@hono/swagger-ui'
import { openApiDoc } from './swingger/ApiDoc.js'

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
app.route("/api/user/@me", userinfoRoute);
app.route("/api/events", publicRoute)
app.route("/api/events", draftRoute)


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
