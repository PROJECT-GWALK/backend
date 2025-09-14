import type { User } from "@prisma/client";
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.js";

const protectedRoute = new Hono<{ Variables: { user: User } }>();

protectedRoute.use("*", authMiddleware);

protectedRoute.get("/", (c) => {
  const user = c.get("user");
  return c.json({ message: "ok", user });
});

export default protectedRoute;