import type { User } from "@prisma/client";
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.js";

const protectedRoute = new Hono<{ Variables: { user: User } }>();

protectedRoute.use("*", authMiddleware);

protectedRoute.get("/", (c) => {
  const user = c.get("user");

  const safeUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    image: user.image,
    description: user.description,
    role: user.role,
  };

  return c.json({ message: "ok", user: safeUser });
});

export default protectedRoute;