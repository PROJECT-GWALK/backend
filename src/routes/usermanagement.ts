import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middlewares/auth.js";
import { adminOnly } from "../middlewares/adminOnly.js";
import { prisma } from "../lib/prisma.js";
import { updateUserRoleSchema, banUserSchema } from "../lib/types.js";
import { createLog } from "../lib/logger.js";

const userManagement = new Hono();

userManagement
  .use("*", authMiddleware, adminOnly)

  .get("/", async (c) => {
    const roleParam = c.req.query("role") as "ADMIN" | "USER" | undefined;
    const page = parseInt(c.req.query("page") || "1", 10);
    const limit = parseInt(c.req.query("limit") || "10", 10);
    const search = c.req.query("search") || "";
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (roleParam) where.role = roleParam;
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { username: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, allUsers] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        take: limit,
        skip,
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          role: true,
          createdAt: true,
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const bans = await prisma.userBan.findMany({
      where: { 
        deletedAt: null,
        email: { in: allUsers.map(u => u.email).filter((e): e is string => !!e) }
      },
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

    return c.json({ 
      message: "ok", 
      users: usersWithStatus,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    });
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

      const admin = c.get("user");
      await createLog(
        admin.id,
        "UPDATE_USER_ROLE",
        `Changed role of user ${updated.email} (${updated.id}) to ${role}`,
        c.req.header("x-forwarded-for"),
        c.req.header("user-agent")
      );

      return c.json({ message: "role updated", user: updated });
    }
  )

  .delete("/:id", async (c) => {
    const { id } = c.req.param();

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    const admin = c.get("user");
    await createLog(
      admin.id,
      "DELETE_USER",
      `Deleted user ${id}`,
      c.req.header("x-forwarded-for"),
      c.req.header("user-agent")
    );

    return c.json({ message: "user deleted" });
  })

  .post(
    "/:id/ban",
    zValidator("json", banUserSchema),
    async (c) => {
      const { id } = c.req.param();
      const { reason, expiresAt } = c.req.valid("json");

      const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
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

      await createLog(
        admin.id,
        "BAN_USER",
        `Banned user ${user.email} (${id}). Reason: ${reason || "No reason"}`,
        c.req.header("x-forwarded-for"),
        c.req.header("user-agent")
      );

      return c.json({ message: "user banned", email: user.email });
    }
  )

  .post("/:id/unban", async (c) => {
    const { id } = c.req.param();
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });

    if (!user || !user.email) {
      return c.json({ message: "user not found or no email" }, 404);
    }

    await prisma.userBan.updateMany({
      where: { email: user.email },
      data: { deletedAt: new Date() },
    });

    const admin = c.get("user");
    await createLog(
      admin.id,
      "UNBAN_USER",
      `Unbanned user ${user.email} (${id})`,
      c.req.header("x-forwarded-for"),
      c.req.header("user-agent")
    );

    return c.json({ message: "user unbanned", email: user.email });
  });

export default userManagement;
