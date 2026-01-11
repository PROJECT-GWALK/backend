import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export async function authMiddleware(c: Context<{ Variables: { user: User } }>, next: Next) {
  let token = getCookie(c, "authjs.session-token");

  if (!token) token = getCookie(c, "__Secure-authjs.session-token");

  if (!token) return c.json({ message: "Unauthorized" }, 401);

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });

  if (!session || session.expires < new Date()) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  await next();
}

export async function optionalAuthMiddleware(c: Context<{ Variables: { user: User | null } }>, next: Next) {
  let token = getCookie(c, "authjs.session-token");

  if (!token) token = getCookie(c, "__Secure-authjs.session-token");

  if (!token) {
    c.set("user", null);
    return next();
  }

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });

  if (!session || session.expires < new Date()) {
    c.set("user", null);
    return next();
  }

  c.set("user", session.user);
  await next();
}