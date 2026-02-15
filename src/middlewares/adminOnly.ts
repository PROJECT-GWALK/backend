import type { Context, Next } from "hono";
import type { User } from "../generated/prisma/client.js";

export async function adminOnly(c: Context<{ Variables: { user: User } }>, next: Next) {
  const user = c.get("user");

  if (!user || user.role !== "ADMIN") {
    return c.json({ message: "Forbidden" }, 403);
  }

  await next();
}