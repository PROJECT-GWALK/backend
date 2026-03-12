import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../../lib/prisma.js";
import type { User } from "../../generated/prisma/client.js";
import {
  idParamSchema,
  addParticipantSchema,
  updateParticipantSchema,
  candidateQuerySchema,
} from "../../lib/types.js";

const participantsRoute = new Hono<{ Variables: { user: User | null } }>();

participantsRoute.post(
  "/:id/participants",
  zValidator("param", idParamSchema),
  zValidator("json", addParticipantSchema),
  async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const { identifier, role } = c.req.valid("json");

    if (!user) return c.json({ message: "Unauthorized" }, 401);

    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", deletedAt: null },
    });
    if (!organizer) return c.json({ message: "Forbidden" }, 403);

    if (role === "ORGANIZER" && !organizer.isLeader) {
      return c.json({ message: "Only organizer leader can add organizers" }, 403);
    }

    const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!event) return c.json({ message: "Event not found" }, 404);

    // Find User
    const targetUser = await prisma.user.findFirst({
      where: {
        OR: [
          { id: identifier }, // Allow direct ID match
          { email: { equals: identifier, mode: "insensitive" } },
          { username: { equals: identifier, mode: "insensitive" } },
          { name: { equals: identifier, mode: "insensitive" } },
        ],
        deletedAt: null,
      },
    });

    if (!targetUser) return c.json({ message: "User not found" }, 404);

    const existing = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: targetUser.id, deletedAt: null },
    });
    if (existing) return c.json({ message: "User already joined" }, 400);

    let virtualReward = 0;
    if (role === "COMMITTEE") {
      virtualReward = event.virtualRewardCommittee ?? 0;
    } else if (role === "GUEST") {
      virtualReward = event.virtualRewardGuest ?? 0;
    }

    const participant = await prisma.eventParticipant.create({
      data: {
        eventId: id,
        userId: targetUser.id,
        eventGroup: role,
        isLeader: false,
        virtualReward,
      },
      include: { user: true, team: { include: { files: true } } },
    });

    const result = {
      ...participant,
      virtualUsed: 0,
    };

    return c.json({ message: "ok", participant: result });
  },
);

participantsRoute.get("/:id/participants", zValidator("param", idParamSchema), async (c) => {
  const user = c.get("user");
  const { id } = c.req.valid("param");
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  const participants = await prisma.eventParticipant.findMany({
    where: { eventId: id, deletedAt: null },
    include: { user: true, team: { include: { files: true } } },
  });

  const rewards = await prisma.teamReward.groupBy({
    by: ["giverId"],
    where: { eventId: id, deletedAt: null },
    _sum: { reward: true },
  });

  const categoryRewards = await prisma.teamRewardCategory.groupBy({
    by: ["giverId"],
    where: { eventId: id, deletedAt: null },
    _sum: { amount: true },
  });

  const rewardMap = new Map<string, number>();
  rewards.forEach((r) =>
    rewardMap.set(r.giverId, (rewardMap.get(r.giverId) || 0) + (r._sum.reward || 0)),
  );
  categoryRewards.forEach((r) =>
    rewardMap.set(r.giverId, (rewardMap.get(r.giverId) || 0) + (r._sum.amount || 0)),
  );

  const participantsWithUsage = participants.map((p) => ({
    ...p,
    virtualUsed: rewardMap.get(p.userId) || 0,
  }));

  return c.json({ message: "ok", participants: participantsWithUsage });
});

participantsRoute.put(
  "/:id/participants/:pid",
  zValidator("json", updateParticipantSchema),
  async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const pid = c.req.param("pid");
    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
    });
    if (!organizer) return c.json({ message: "Forbidden" }, 403);
    const body = c.req.valid("json");
    const data: {
      eventGroup?: "ORGANIZER" | "PRESENTER" | "COMMITTEE" | "GUEST";
      isLeader?: boolean;
      virtualReward?: number;
      teamId?: string | null;
    } = {};
    const eg = body.eventGroup;
    if (eg) {
      data.eventGroup = eg;

      // Auto-update virtual reward based on role
      const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
      if (event) {
        if (eg === "ORGANIZER" || eg === "PRESENTER") {
          data.virtualReward = 0;
        } else if (eg === "COMMITTEE") {
          data.virtualReward = event.virtualRewardCommittee ?? 0;
        } else if (eg === "GUEST") {
          data.virtualReward = event.virtualRewardGuest ?? 0;
        }
      }
    }

    const existing = await prisma.eventParticipant.findFirst({ where: { id: pid, eventId: id, deletedAt: null } });
    if (!existing) return c.json({ message: "Participant not found" }, 404);

    // If role changes, reset scores/rewards given by this user
    if (data.eventGroup && data.eventGroup !== existing.eventGroup) {
      // 1. Soft Delete Virtual Rewards (TeamReward) given by this user in this event
      await prisma.teamReward.updateMany({
        where: {
          eventId: id,
          giverId: existing.userId,
        },
        data: { deletedAt: new Date() },
      });

      await prisma.teamRewardCategory.updateMany({
        where: {
          eventId: id,
          giverId: existing.userId,
        },
        data: { deletedAt: new Date() },
      });

      // 2. Soft Delete Special Rewards (SpecialRewardVote) given by this committee (participant)
      // Note: SpecialRewardVote uses committeeId which is the participant ID
      await prisma.specialRewardVote.updateMany({
        where: {
          committeeId: pid, // pid is existing.id
        },
        data: { deletedAt: new Date() },
      });
    }

    if (typeof body.isLeader === "boolean") data.isLeader = body.isLeader;
    if (typeof body.virtualReward === "number")
      data.virtualReward = Math.max(0, body.virtualReward);
    if (body.teamId === null) data.teamId = null;
    else if (body.teamId) data.teamId = body.teamId;

    if (existing.eventGroup === "ORGANIZER") {
      if (!organizer.isLeader) {
        return c.json({ message: "Only organizer leader can manage organizer group" }, 403);
      }
      if (existing.userId === user?.id) {
        return c.json({ message: "Organizer leader cannot manage self" }, 403);
      }
      if (typeof body.isLeader === "boolean") {
        return c.json({ message: "Cannot change organizer leader flag" }, 403);
      }
    } else {
      if (!organizer.isLeader && body.eventGroup === "ORGANIZER") {
        return c.json({ message: "Only organizer leader can assign organizer role" }, 403);
      }
      // Handle leaving Presenter role with team logic
      if (
        existing.eventGroup === "PRESENTER" &&
        data.eventGroup &&
        data.eventGroup !== "PRESENTER" &&
        existing.teamId
      ) {
        if (existing.isLeader) {
          // Leader leaving: Delete team and remove all members from it
          await prisma.eventParticipant.updateMany({
            where: { teamId: existing.teamId },
            data: { teamId: null, isLeader: false },
          });
          // Soft delete team
          await prisma.team.update({ 
            where: { id: existing.teamId },
            data: { deletedAt: new Date() },
          });
          data.teamId = null;
          data.isLeader = false;
        } else {
          // Member leaving: Just remove from team
          data.teamId = null;
        }
      }
    }
    const updated = await prisma.eventParticipant.update({
      where: { id: pid },
      data,
      include: { user: true, team: true },
    });
    return c.json({ message: "ok", participant: updated });
  },
);

participantsRoute.delete("/:id/participants/:pid", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  const existing = await prisma.eventParticipant.findFirst({ where: { id: pid, eventId: id, deletedAt: null } });
  if (!existing) return c.json({ message: "Participant not found" }, 404);
  if (existing.eventGroup === "ORGANIZER") {
    if (!organizer.isLeader)
      return c.json({ message: "Only organizer leader can delete organizer" }, 403);
    if (existing.userId === user?.id) {
      return c.json({ message: "Organizer leader cannot delete self" }, 403);
    }
  }
  // Soft delete participant
  await prisma.eventParticipant.update({ 
    where: { id: pid },
    data: { deletedAt: new Date() }
  });
  return c.json({ message: "ok" });
});

participantsRoute.get(
  "/:id/presenters/candidates",
  zValidator("param", idParamSchema),
  zValidator("query", candidateQuerySchema),
  async (c) => {
    const { id: eventId } = c.req.valid("param");
    const { q } = c.req.valid("query");

    if (!q || q.length < 2) return c.json({ message: "ok", candidates: [] });

    const presenterCandidates = await prisma.eventParticipant.findMany({
      where: {
        eventId,
        eventGroup: "PRESENTER",
        teamId: null,
        deletedAt: null,
        user: {
          OR: [
            { name: { contains: q } },
            { username: { contains: q } },
            { email: { contains: q } },
          ],
          deletedAt: null,
        },
      },
      include: { user: true },
      take: 10,
    });

    const participantCandidates = presenterCandidates.map((c) => ({
      id: c.id,
      userId: c.userId,
      name: c.user.name,
      username: c.user.username,
      image: c.user.image,
    }));

    const remaining = Math.max(0, 10 - participantCandidates.length);
    let extraUsers: { id: string; name: string | null; username: string | null; image: string | null }[] = [];
    if (remaining > 0) {
      extraUsers = await prisma.user.findMany({
        where: {
          OR: [{ name: { contains: q } }, { username: { contains: q } }, { email: { contains: q } }],
          participants: { none: { eventId, deletedAt: null } },
          deletedAt: null,
        },
        select: { id: true, name: true, username: true, image: true },
        take: remaining,
      });
    }

    return c.json({
      message: "ok",
      candidates: [
        ...participantCandidates,
        ...extraUsers.map((u) => ({
          id: u.id,
          userId: u.id,
          name: u.name,
          username: u.username,
          image: u.image,
        })),
      ],
    });
  },
);

export default participantsRoute;
