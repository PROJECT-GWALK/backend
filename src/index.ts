import { serve } from "@hono/node-server";
import { Hono } from "hono";
import userManagement from "./routes/usermanagement.js";
import adminDashboard from "./routes/admindashboard.js";
import filesRoute from "./routes/files.js";
import eventsRoute from "./routes/events/index.js";
import evaluationRoute from "./routes/evaluation.js";
import systemLogs from "./routes/systemlogs.js";
import { swaggerUI } from "@hono/swagger-ui";
import { openApiDoc } from "./swingger/ApiDoc.js";
import { userRoute, userProfileRoute } from "./routes/userinfo.js";
import { prisma } from "./lib/prisma.js";

const app = new Hono();

//////////////////////////////////////////////////////////
// SWAGGER UI
//////////////////////////////////////////////////////////
app.get("/openapi.json", (c) => {
  return c.json(openApiDoc);
});

app.get("/api/health/db", async (c) => {
  try {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - startedAt;
    return c.json({ message: "ok", database: "connected", latencyMs });
  } catch {
    return c.json({ message: "Database connection failed" }, 500);
  }
});
app.get(
  "/",
  swaggerUI({
    url: "/openapi.json",
  }),
);

//////////////////////////////////////////////////////////
// BUCKET FILES
//////////////////////////////////////////////////////////
app.route("/files", filesRoute);

//////////////////////////////////////////////////////////
// USER
//////////////////////////////////////////////////////////
app.route("/api/user/@me", userRoute);
app.route("/api/user", userProfileRoute);
app.route("/api/events", eventsRoute);
app.route("/api/evaluation", evaluationRoute);

//////////////////////////////////////////////////////////
// ADMIN
//////////////////////////////////////////////////////////
app.route("/api/usermanagement", userManagement);
app.route("/api/admindashboard", adminDashboard);
app.route("/api/systemlogs", systemLogs);

serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
