import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middlewares/auth.js";
import { adminOnly } from "../middlewares/adminOnly.js";
import { prisma } from "../lib/prisma.js";
import { updateUserRoleSchema, banUserSchema } from "../lib/types.js";

const userManagement = new Hono();

userManagement
  .use("*", authMiddleware, adminOnly)

  .get("/", async (c) => {
    const roleParam = c.req.query("role") as "ADMIN" | "USER" | undefined;

    const allUsers = await prisma.user.findMany({
      where: roleParam ? { role: roleParam } : undefined,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });

    const bans = await prisma.userBan.findMany({
      select: { email: true, expiresAt: true },
    });

    const bannedEmails = new Set(
      bans
        .filter((b) => !b.expiresAt || b.expiresAt > new Date())
        .map((b) => b.email)
    );

    const usersWithStatus = allUsers.map((u) => ({
      ...u,
      banned: bannedEmails.has(u.email ?? ""),
    }));

    return c.json({ message: "ok", users: usersWithStatus });
  })

  .put(
    "/:id/role",
    zValidator("json", updateUserRoleSchema),
    async (c) => {
      const { id } = c.req.param();
      const { role } = c.req.valid("json");

      const updated = await prisma.user.update({
        where: { id },
        data: { role },
        select: { id: true, email: true, role: true },
      });

      return c.json({ message: "role updated", user: updated });
    }
  )

  .delete("/:id", async (c) => {
    const { id } = c.req.param();

    await prisma.user.delete({
      where: { id },
    });

    return c.json({ message: "user deleted" });
  })

  .post(
    "/:id/ban",
    zValidator("json", banUserSchema),
    async (c) => {
      const { id } = c.req.param();
      const { reason, expiresAt } = c.req.valid("json");

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user || !user.email) {
        return c.json({ message: "user not found or no email" }, 404);
      }

      const admin = c.get("user");
      await prisma.userBan.create({
        data: {
          email: user.email,
          reason: reason ?? null,
          bannedBy: admin.id,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      return c.json({ message: "user banned", email: user.email });
    }
  )

  .post("/:id/unban", async (c) => {
    const { id } = c.req.param();
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user || !user.email) {
      return c.json({ message: "user not found or no email" }, 404);
    }

    await prisma.userBan.deleteMany({
      where: { email: user.email },
    });

    return c.json({ message: "user unbanned", email: user.email });
  });

export default userManagement;
