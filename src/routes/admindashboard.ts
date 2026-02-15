import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middlewares/auth.js";
import { adminOnly } from "../middlewares/adminOnly.js";
import { prisma } from "../lib/prisma.js";
import { adminDashboardParams, updateParticipantSchema } from "../lib/types.js";

const adminDashboard = new Hono();

const adminEventIdParamSchema = z.object({
  eventId: z.string().min(1),
});

const adminEventParticipantParamSchema = z.object({
  eventId: z.string().min(1),
  pid: z.string().min(1),
});

const adminEventTeamParamSchema = z.object({
  eventId: z.string().min(1),
  teamId: z.string().min(1),
});

const adminUpdateEventSchema = z.object({
  eventName: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  publicView: z.boolean().optional(),
  publicJoin: z.boolean().optional(),
  gradingEnabled: z.boolean().optional(),
});

const adminUpdateTeamSchema = z.object({
  teamName: z.string().min(1).optional(),
  description: z.string().optional(),
  videoLink: z.string().optional(),
  imageCover: z.string().nullable().optional(),
});

adminDashboard
  .use("*", authMiddleware, adminOnly)

  .get(
    "/userdailyactive/:year?/:month?",
    zValidator("param", adminDashboardParams),
    async (c) => {
      const { year: yearParam, month: monthParam } = c.req.valid("param");

      let buddhistYear = yearParam ? parseInt(yearParam, 10) : null;
    if (!buddhistYear) {
      const now = new Date();
      buddhistYear = now.getFullYear() + 543;
    }
    const christianYear = buddhistYear - 543;

    let startDate: Date;
    let endDate: Date;
    if (monthParam) {
      const month = parseInt(monthParam, 10) - 1;
      startDate = new Date(christianYear, month, 1);
      endDate = new Date(christianYear, month + 1, 1);
    } else {
      startDate = new Date(christianYear, 0, 1);
      endDate = new Date(christianYear + 1, 0, 1);
    }

    const distinctYears = await prisma.userDailyActive.findMany({
      select: { date: true },
      distinct: ["date"],
      orderBy: { date: "asc" },
    });

    const availableYears = [
      ...new Set(
        distinctYears.map((u) => new Date(u.date).getFullYear() + 543)
      ),
    ].sort((a, b) => b - a);

    let chart: { label: string; count: number }[] = [];

    if (monthParam) {
      const daily = await prisma.userDailyActive.groupBy({
        by: ["date", "userId"],
        where: {
          date: {
            gte: startDate,
            lt: endDate,
          },
        },
      });

      const grouped: Record<string, Set<string>> = {};
      daily.forEach((u) => {
        const key = new Date(u.date).toLocaleDateString("en-US", {
          day: "numeric",
        });
        if (!grouped[key]) grouped[key] = new Set();
        grouped[key].add(u.userId);
      });

      chart = Object.entries(grouped).map(([label, users]) => ({
        label,
        count: users.size,
      }));
    } else {
      const monthly = await prisma.userDailyActive.groupBy({
        by: ["date", "userId"],
        where: {
          date: {
            gte: startDate,
            lt: endDate,
          },
        },
      });

      const grouped: Record<string, Set<string>> = {};
      monthly.forEach((u) => {
        const key = new Date(u.date).toLocaleDateString("en-US", {
          month: "long",
        });
        if (!grouped[key]) grouped[key] = new Set();
        grouped[key].add(u.userId);
      });

      chart = Object.entries(grouped).map(([label, users]) => ({
        label,
        count: users.size,
      }));
    }

    return c.json({
      message: "ok",
      data: {
        year: buddhistYear,
        month: monthParam ? parseInt(monthParam, 10) : null,
        availableYears,
        chart,
      },
    });
  })

  .get("/users", async (c) => {
    const count = await prisma.user.count();

    return c.json({ message: "ok", totalUsers: count });
  })

  .get("/events", async (c) => {
    const count = await prisma.event.count();

    return c.json({ message: "ok", totalEvents: count });
  })

  .get("/events/list", async (c) => {
    const q = (c.req.query("q") || "").trim();
    const statusParam = c.req.query("status");
    const status =
      statusParam === "DRAFT" || statusParam === "PUBLISHED" ? statusParam : undefined;

    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (q) where.eventName = { contains: q, mode: "insensitive" };
    if (status) where.status = status;

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          eventName: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          startJoinDate: true,
          endJoinDate: true,
          publicView: true,
          publicJoin: true,
          _count: { select: { participants: true, teams: true } },
        },
      }),
      prisma.event.count({ where }),
    ]);

    const payload = events.map((e) => ({
      id: e.id,
      eventName: e.eventName,
      status: e.status,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      startJoinDate: e.startJoinDate,
      endJoinDate: e.endJoinDate,
      publicView: e.publicView,
      publicJoin: e.publicJoin,
      participantsCount: e._count.participants,
      teamsCount: e._count.teams,
    }));

    return c.json({
      message: "ok",
      events: payload,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  })

  .get(
    "/events/:eventId",
    zValidator("param", adminEventIdParamSchema),
    async (c) => {
      const { eventId } = c.req.valid("param");

      const event = await prisma.event.findUnique({
        where: { id: eventId },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                  email: true,
                  image: true,
                  role: true,
                },
              },
              team: { select: { id: true, teamName: true } },
            },
            orderBy: { id: "asc" },
          },
          teams: {
            include: {
              participants: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      username: true,
                      email: true,
                      image: true,
                    },
                  },
                },
                orderBy: { id: "asc" },
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!event) return c.json({ message: "Event not found" }, 404);

      return c.json({ message: "ok", event });
    },
  )

  .put(
    "/events/:eventId",
    zValidator("param", adminEventIdParamSchema),
    zValidator("json", adminUpdateEventSchema),
    async (c) => {
      const { eventId } = c.req.valid("param");
      const body = c.req.valid("json");

      const existing = await prisma.event.findUnique({ where: { id: eventId } });
      if (!existing) return c.json({ message: "Event not found" }, 404);

      const updated = await prisma.event.update({
        where: { id: eventId },
        data: body,
      });

      return c.json({ message: "ok", event: updated });
    },
  )

  .delete(
    "/events/:eventId",
    zValidator("param", adminEventIdParamSchema),
    async (c) => {
      const { eventId } = c.req.valid("param");

      const existing = await prisma.event.findUnique({ where: { id: eventId } });
      if (!existing) return c.json({ message: "Event not found" }, 404);

      await prisma.event.delete({ where: { id: eventId } });
      return c.json({ message: "ok", deletedId: eventId });
    },
  )

  .put(
    "/events/:eventId/participants/:pid",
    zValidator("param", adminEventParticipantParamSchema),
    zValidator("json", updateParticipantSchema),
    async (c) => {
      const { eventId, pid } = c.req.valid("param");
      const body = c.req.valid("json");

      const existing = await prisma.eventParticipant.findFirst({
        where: { id: pid, eventId },
      });
      if (!existing) return c.json({ message: "Participant not found" }, 404);

      const data: {
        eventGroup?: "ORGANIZER" | "PRESENTER" | "COMMITTEE" | "GUEST";
        isLeader?: boolean;
        virtualReward?: number;
        teamId?: string | null;
      } = {};

      if (body.eventGroup) data.eventGroup = body.eventGroup;
      if (typeof body.virtualReward === "number") {
        data.virtualReward = Math.max(0, body.virtualReward);
      }

      if (body.teamId === null) {
        data.teamId = null;
        data.isLeader = false;
      } else if (body.teamId) {
        const team = await prisma.team.findUnique({ where: { id: body.teamId } });
        if (!team || team.eventId !== eventId) {
          return c.json({ message: "Team not found" }, 404);
        }
        data.teamId = body.teamId;
      }

      if (
        existing.eventGroup === "PRESENTER" &&
        data.eventGroup &&
        data.eventGroup !== "PRESENTER" &&
        existing.teamId
      ) {
        if (existing.isLeader) {
          await prisma.eventParticipant.updateMany({
            where: { teamId: existing.teamId },
            data: { teamId: null, isLeader: false },
          });
          await prisma.team.delete({ where: { id: existing.teamId } });
          data.teamId = null;
          data.isLeader = false;
        } else {
          data.teamId = null;
          data.isLeader = false;
        }
      }

      if (typeof body.isLeader === "boolean") {
        if (body.isLeader) {
          const effectiveTeamId = data.teamId ?? existing.teamId;
          if (!effectiveTeamId) {
            return c.json({ message: "Leader must belong to a team" }, 400);
          }
          await prisma.eventParticipant.updateMany({
            where: { teamId: effectiveTeamId },
            data: { isLeader: false },
          });
          data.isLeader = true;
        } else {
          data.isLeader = false;
        }
      }

      const updated = await prisma.eventParticipant.update({
        where: { id: pid },
        data,
        include: { user: true, team: true },
      });

      return c.json({ message: "ok", participant: updated });
    },
  )

  .delete(
    "/events/:eventId/participants/:pid",
    zValidator("param", adminEventParticipantParamSchema),
    async (c) => {
      const { eventId, pid } = c.req.valid("param");

      const existing = await prisma.eventParticipant.findFirst({
        where: { id: pid, eventId },
      });
      if (!existing) return c.json({ message: "Participant not found" }, 404);

      const teamId = existing.teamId;
      const wasLeader = existing.isLeader;

      await prisma.eventParticipant.delete({ where: { id: pid } });

      if (teamId) {
        if (wasLeader) {
          await prisma.eventParticipant.updateMany({
            where: { teamId },
            data: { teamId: null, isLeader: false },
          });
          await prisma.team.delete({ where: { id: teamId } });
        } else {
          const remaining = await prisma.eventParticipant.count({ where: { teamId } });
          if (remaining === 0) {
            await prisma.team.delete({ where: { id: teamId } });
          } else {
            const leader = await prisma.eventParticipant.findFirst({
              where: { teamId, isLeader: true },
              select: { id: true },
            });
            if (!leader) {
              const nextLeader = await prisma.eventParticipant.findFirst({
                where: { teamId },
                orderBy: { id: "asc" },
                select: { id: true },
              });
              if (nextLeader) {
                await prisma.eventParticipant.update({
                  where: { id: nextLeader.id },
                  data: { isLeader: true },
                });
              }
            }
          }
        }
      }

      return c.json({ message: "ok" });
    },
  )

  .put(
    "/events/:eventId/teams/:teamId",
    zValidator("param", adminEventTeamParamSchema),
    zValidator("json", adminUpdateTeamSchema),
    async (c) => {
      const { eventId, teamId } = c.req.valid("param");
      const body = c.req.valid("json");

      const existing = await prisma.team.findUnique({ where: { id: teamId } });
      if (!existing || existing.eventId !== eventId) return c.json({ message: "Team not found" }, 404);

      const updated = await prisma.team.update({
        where: { id: teamId },
        data: body,
      });

      return c.json({ message: "ok", team: updated });
    },
  )

  .delete(
    "/events/:eventId/teams/:teamId",
    zValidator("param", adminEventTeamParamSchema),
    async (c) => {
      const { eventId, teamId } = c.req.valid("param");

      const existing = await prisma.team.findUnique({ where: { id: teamId } });
      if (!existing || existing.eventId !== eventId) return c.json({ message: "Team not found" }, 404);

      await prisma.eventParticipant.updateMany({
        where: { teamId },
        data: { teamId: null, isLeader: false },
      });

      await prisma.team.delete({ where: { id: teamId } });

      return c.json({ message: "ok" });
    },
  );

export default adminDashboard;
