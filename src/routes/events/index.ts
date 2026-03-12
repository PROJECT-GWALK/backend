import { Hono } from "hono";
import { authMiddleware, optionalAuthMiddleware } from "../../middlewares/auth.js";
import eventsActionRoute from "../eventsAction.js";
import type { User } from "../../generated/prisma/client.js";

import coreRoute from "./core.js";
import statsRoute from "./stats.js";
import invitesRoute from "./invites.js";
import participantsRoute from "./participants.js";
import teamsRoute from "./teams.js";
import managementRoute from "./management.js";

const eventsRoute = new Hono<{ Variables: { user: User | null } }>();

// Mount sub-routes for actions
eventsRoute.route("/:eventId/action", eventsActionRoute);

// Apply auth middleware logic
eventsRoute.use("*", async (c, next) => {
  const path = c.req.path;
  const method = c.req.method;

  // Allow optional auth for GET /api/events/:id (UUID) and GET /api/events
  if (
    method === "GET" &&
    (/\/api\/events\/[0-9a-fA-F-]{36}$/.test(path) ||
      /\/api\/events\/[0-9a-fA-F-]{36}\/teams\/[0-9a-fA-F-]{36}$/.test(path) ||
      path.endsWith("/api/events") ||
      path.endsWith("/api/events/") ||
      /\/api\/events\/user\/.*\/history$/.test(path))
  ) {
    return optionalAuthMiddleware(c, next);
  }

  return authMiddleware(c as any, next);
});

// Mount categorized routes
// Order matters: specific routes first
eventsRoute.route("/", statsRoute);
eventsRoute.route("/", invitesRoute);
eventsRoute.route("/", participantsRoute);
eventsRoute.route("/", teamsRoute);
eventsRoute.route("/", managementRoute);
eventsRoute.route("/", coreRoute); // coreRoute handles generic paths like /:id and /

export default eventsRoute;
