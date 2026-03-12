import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../../lib/prisma.js";
import type { User } from "../../generated/prisma/client.js";
import {
  idParamSchema,
  inviteRoleQuerySchema,
  invitePreviewSchema,
  inviteSchema,
} from "../../lib/types.js";
import { signInvite, verifyInvite, roleMap } from "./helpers.js";

const invitesRoute = new Hono<{ Variables: { user: User | null } }>();

invitesRoute.get(
  "/:id/invite/sign",
  zValidator("param", idParamSchema),
  zValidator("query", inviteRoleQuerySchema),
  async (c) => {
    const user = c.get("user");
    const { id: eventId } = c.req.valid("param");
    const { role } = c.req.valid("query");

    if (!user) return c.json({ message: "Unauthorized" }, 401);
    if (role === "organizer") return c.json({ message: "Forbidden" }, 403);
    const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event || event.status !== "PUBLISHED" || event.isHidden) return c.json({ message: "Event not found" }, 404);
    const existing = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user.id, deletedAt: null },
    });
    if (existing) return c.json({ message: "Already joined" }, 400);
    const sig = signInvite(eventId, user.id, role);
    return c.json({ message: "ok", sig });
  },
);

invitesRoute.get(
  "/:id/invite/token",
  zValidator("param", idParamSchema),
  zValidator("query", inviteRoleQuerySchema),
  async (c) => {
    const user = c.get("user");
    const { id: eventId } = c.req.valid("param");
    const { role } = c.req.valid("query");

    const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event || event.status !== "PUBLISHED" || event.isHidden) return c.json({ message: "Event not found" }, 404);

    if (role === "organizer") {
      const organizer = await prisma.eventParticipant.findFirst({
        where: { eventId, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
      });
      if (!organizer) return c.json({ message: "Forbidden" }, 403);
    }

    try {
      const selectBase = {
        id: true,
        eventId: true,
        committeeToken: true,
        presenterToken: true,
        guestToken: true,
      } as const;

      let linkInvite = await prisma.linkInvite.findFirst({
        where: { eventId, deletedAt: null },
        select: role === "organizer" ? { ...selectBase, organizerToken: true } : selectBase,
      });

      if (!linkInvite) {
        linkInvite = await prisma.linkInvite.create({
          data: { eventId },
          select: role === "organizer" ? { ...selectBase, organizerToken: true } : selectBase,
        });
      }

      let token = "";
      if (role === "committee") token = linkInvite.committeeToken;
      else if (role === "presenter") token = linkInvite.presenterToken;
      else if (role === "guest") token = linkInvite.guestToken;
      else if (role === "organizer") {
        const current = (linkInvite as { organizerToken?: string | null }).organizerToken ?? null;
        if (current) {
          token = current;
        } else {
          const newToken = crypto.randomUUID();
          await prisma.linkInvite.update({
            where: { eventId },
            data: { organizerToken: newToken },
            select: { id: true },
          });
          token = newToken;
        }
      }

      return c.json({ message: "ok", token });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === "P2022") {
        return c.json({ message: "Database schema is outdated. Please update LinkInvite columns." }, 500);
      }
      throw e;
    }
  },
);

invitesRoute.post(
  "/:id/invite/token/refresh",
  zValidator("query", inviteRoleQuerySchema),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("id");
    const { role } = c.req.valid("query");

    const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event || event.status !== "PUBLISHED" || event.isHidden) return c.json({ message: "Event not found" }, 404);

    // Check if user is an organizer
    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
    });
    if (!organizer) return c.json({ message: "Forbidden" }, 403);

    try {
      const selectBase = {
        id: true,
        eventId: true,
        committeeToken: true,
        presenterToken: true,
        guestToken: true,
      } as const;

      const existing = await prisma.linkInvite.findFirst({
        where: { eventId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) {
        await prisma.linkInvite.create({
          data: { eventId },
          select: { id: true },
        });
      }

      const updatedLinkInvite = await prisma.linkInvite.update({
        where: { eventId },
        data: {
          committeeToken: role === "committee" ? crypto.randomUUID() : undefined,
          presenterToken: role === "presenter" ? crypto.randomUUID() : undefined,
          guestToken: role === "guest" ? crypto.randomUUID() : undefined,
          organizerToken: role === "organizer" ? crypto.randomUUID() : undefined,
        },
        select: role === "organizer" ? { ...selectBase, organizerToken: true } : selectBase,
      });

      let token = "";
      if (role === "committee") token = updatedLinkInvite.committeeToken;
      else if (role === "presenter") token = updatedLinkInvite.presenterToken;
      else if (role === "guest") token = updatedLinkInvite.guestToken;
      else if (role === "organizer")
        token = (updatedLinkInvite as { organizerToken?: string | null }).organizerToken || "";

      return c.json({ message: "ok", token });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code === "P2022") {
        return c.json({ message: "Database schema is outdated. Please update LinkInvite columns." }, 500);
      }
      throw e;
    }
  },
);

// Preview invite (no auth required). Returns role if the token/role is valid for this event.
invitesRoute.get(
  "/:id/invite/preview",
  zValidator("param", idParamSchema),
  zValidator("query", invitePreviewSchema),
  async (c) => {
    const { id: eventId } = c.req.valid("param");
    const { token, role: roleParam } = c.req.valid("query");

    const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event || event.status !== "PUBLISHED" || event.isHidden) return c.json({ message: "Event not found" }, 404);

    if (token) {
      const linkInvite = await prisma.linkInvite.findFirst({
        where: { eventId, deletedAt: null },
        select: { committeeToken: true, presenterToken: true, guestToken: true },
      });
      if (!linkInvite) return c.json({ message: "invalid token" }, 400);

      let organizerToken: string | null = null;
      try {
        const maybe = await prisma.linkInvite.findFirst({
          where: { eventId, deletedAt: null },
          select: { organizerToken: true },
        });
        organizerToken = maybe?.organizerToken ?? null;
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err?.code !== "P2022") throw e;
      }

      let role: keyof typeof roleMap | null = null;
      if (linkInvite.committeeToken === token) role = "committee";
      else if (linkInvite.presenterToken === token) role = "presenter";
      else if (linkInvite.guestToken === token) role = "guest";
      else if (organizerToken && organizerToken === token) role = "organizer";

      if (!role) return c.json({ message: "invalid token" }, 400);
      return c.json({ message: "ok", role: role });
    }

    if (!roleParam || !(roleParam in roleMap)) return c.json({ message: "invalid role" }, 400);
    return c.json({ message: "ok", role: roleParam });
  },
);

invitesRoute.post(
  "/:id/invite",
  zValidator("param", idParamSchema),
  zValidator("query", inviteSchema),
  async (c) => {
    const user = c.get("user");
    const { id: eventId } = c.req.valid("param");
    const { token, role, sig } = c.req.valid("query");

    const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event || event.status !== "PUBLISHED") return c.json({ message: "Event not found" }, 404);
    if (!user) return c.json({ message: "Unauthorized" }, 401);

    const existing = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user?.id, deletedAt: null },
    });
    if (existing) return c.json({ message: "Already joined" }, 400);

    let targetRole: "ORGANIZER" | "PRESENTER" | "GUEST" | "COMMITTEE" | undefined;

    if (token) {
      const linkInvite = await prisma.linkInvite.findFirst({
        where: { eventId, deletedAt: null },
        select: { committeeToken: true, presenterToken: true, guestToken: true },
      });
      if (!linkInvite) return c.json({ message: "invalid token" }, 400);

      if (linkInvite.committeeToken === token) targetRole = "COMMITTEE";
      else if (linkInvite.presenterToken === token) targetRole = "PRESENTER";
      else if (linkInvite.guestToken === token) targetRole = "GUEST";
      else {
        let organizerToken: string | null = null;
        try {
          const maybe = await prisma.linkInvite.findFirst({
            where: { eventId, deletedAt: null },
            select: { organizerToken: true },
          });
          organizerToken = maybe?.organizerToken ?? null;
        } catch (e: unknown) {
          const err = e as { code?: string };
          if (err?.code !== "P2022") throw e;
        }

        if (organizerToken && organizerToken === token) targetRole = "ORGANIZER";
        else return c.json({ message: "invalid token" }, 400);
      }
    } else {
      if (!role || !(role in roleMap)) return c.json({ message: "invalid role" }, 400);
      if (!sig || !verifyInvite(eventId, user.id, role, sig))
        return c.json({ message: "invalid signature" }, 400);
      targetRole = roleMap[role];
    }

    if (!targetRole) return c.json({ message: "invalid role" }, 400);

    // Check period based on resolved targetRole
    if (targetRole === "PRESENTER") {
      const now = new Date();
      if (event.startJoinDate && now < event.startJoinDate) {
        return c.json({ message: "Not in joining period" }, 400);
      }
      if (event.endJoinDate && now > event.endJoinDate) {
        return c.json({ message: "Joining period has ended" }, 400);
      }
    } else if (targetRole === "GUEST") {
      const now = new Date();
      if (event.startView && now < event.startView) {
        const guestOpenAt = new Date(event.startView.getTime() - 60 * 60 * 1000);
        if (now < guestOpenAt) {
          return c.json({ message: "Not in view period" }, 400);
        }
      }
      if (event.endView && now > event.endView) {
        return c.json({ message: "View period has ended" }, 400);
      }
    }

    let virtualReward = 0;
    if (targetRole === "COMMITTEE") {
      virtualReward = event.virtualRewardCommittee ?? 0;
    } else if (targetRole === "GUEST") {
      virtualReward = event.virtualRewardGuest ?? 0;
    }

    const created = await prisma.eventParticipant.create({
      data: {
        eventId,
        userId: user.id,
        eventGroup: targetRole,
        isLeader: false,
        virtualReward,
      },
    });
    return c.json({ message: "ok", participant: created });
  },
);

export default invitesRoute;
