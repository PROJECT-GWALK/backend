import type { User } from "@prisma/client";
import type { Context, Next } from "hono";

export async function adminOnly(c: Context<{ Variables: { user: User } }>, next: Next) {
  const user = c.get("user");

  if (!user || user.role !== "ADMIN") {
    return c.json({ message: "Forbidden" }, 403);
  }

  await next();
}