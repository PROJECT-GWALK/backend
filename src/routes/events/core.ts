import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { optionalAuthMiddleware, authMiddleware } from "../../middlewares/auth.js";
import { idParamSchema } from "../../lib/types.js";
import type { User } from "../../generated/prisma/client.js";
import { normalizeEventName, withCompetitionRank, sortTeamScores, buildTeamScores } from "./helpers.js";

const coreRoute = new Hono<{ Variables: { user: User | null } }>();

coreRoute.get("/check-name", async (c) => {
  try {
    const eventName = c.req.query("eventName");
    if (!eventName || typeof eventName !== "string") {
      return c.json({ message: "eventName is required" }, 400);
    }
    const normalizedName = normalizeEventName(eventName);
    if (normalizedName.length < 1) return c.json({ message: "eventName is required" }, 400);
    const exists = await prisma.event.findFirst({
      where: { eventName: { equals: normalizedName, mode: "insensitive" }, deletedAt: null },
    });
    return c.json({ message: "ok", available: !exists });
  } catch {
    return c.json({ message: "Internal server error" }, 500);
  }
});

const eventsQuerySchema = z.object({
  page: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 12)),
});

coreRoute.get("/", zValidator("query", eventsQuerySchema), async (c) => {
  const user = c.get("user");
  const { page, limit } = c.req.valid("query");
  const skip = (page - 1) * limit;

  // Use a dummy UUID if user is not logged in to prevent fetching all participants
  const userId = user?.id || "00000000-0000-0000-0000-000000000000";
  
  const [total, events] = await Promise.all([
    prisma.event.count({
      where: { status: "PUBLISHED", publicView: true, isHidden: false, deletedAt: null },
    }),
    prisma.event.findMany({
      where: { status: "PUBLISHED", publicView: true, isHidden: false, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: skip,
      select: {
        id: true,
        eventName: true,
        status: true,
        createdAt: true,
        imageCover: true,
        startView: true,
        endView: true,
        startJoinDate: true,
        endJoinDate: true,
        publicView: true,
        participants: {
          where: { deletedAt: null },
          select: {
            userId: true,
            eventGroup: true,
            isLeader: true,
            user: { select: { name: true, image: true } },
          },
        },
        ratings: { where: { userId, deletedAt: null }, select: { rating: true } },
      },
    }),
  ]);

  const payload = events.map((e) => {
    const currentUserParticipant = e.participants.find((p) => p.userId === userId);
    const organizer =
      e.participants.find((p) => p.eventGroup === "ORGANIZER" && p.isLeader) ||
      e.participants.find((p) => p.eventGroup === "ORGANIZER");
    return {
      id: e.id,
      eventName: e.eventName,
      status: e.status,
      createdAt: e.createdAt,
      imageCover: e.imageCover,
      startView: e.startView,
      endView: e.endView,
      startJoinDate: e.startJoinDate,
      endJoinDate: e.endJoinDate,
      publicView: e.publicView,
      role: currentUserParticipant?.eventGroup || null,
      isLeader: currentUserParticipant?.isLeader || false,
      userRating: e.ratings?.[0]?.rating || null,
      organizerName: organizer?.user?.name || null,
      organizerImage: organizer?.user?.image || null,
    };
  });
  return c.json({ 
    message: "ok", 
    events: payload,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  });
});

coreRoute.get("/me", async (c) => {
  const user = c.get("user");
  const events = await prisma.event.findMany({
    where: {
      status: { not: "DRAFT" },
      participants: { some: { userId: user?.id, deletedAt: null } },
      isHidden: false,
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      eventName: true,
      status: true,
      createdAt: true,
      imageCover: true,
      startView: true,
      endView: true,
      startJoinDate: true,
      endJoinDate: true,
      publicView: true,
      participants: { where: { userId: user?.id, deletedAt: null }, select: { eventGroup: true, isLeader: true } },
      ratings: { where: { userId: user?.id, deletedAt: null }, select: { rating: true } },
    },
  });
  const payload = events.map((e) => ({
    id: e.id,
    eventName: e.eventName,
    status: e.status,
    createdAt: e.createdAt,
    imageCover: e.imageCover,
    startView: e.startView,
    endView: e.endView,
    startJoinDate: e.startJoinDate,
    endJoinDate: e.endJoinDate,
    publicView: e.publicView,
    role: e.participants?.[0]?.eventGroup || null,
    isLeader: e.participants?.[0]?.isLeader || false,
    userRating: e.ratings?.[0]?.rating || null,
  }));
  return c.json({ message: "ok", events: payload });
});

coreRoute.get("/me/history", async (c) => {
  const user = c.get("user");
  const now = new Date();

  // 1. Participated (Presenter, Guest, Committee)
  const participated = await prisma.eventParticipant.findMany({
    where: {
      userId: user?.id,
      eventGroup: { not: "ORGANIZER" },
      deletedAt: null,
      event: {
        status: "PUBLISHED",
        publicView: true,
        isHidden: false,
        deletedAt: null,
      },
    },
    include: {
      event: true,
      team: {
        where: { deletedAt: null },
      },
    },
    orderBy: {
      event: { createdAt: "desc" },
    },
  });

  const participatedData = await Promise.all(
    participated.map(async (p) => {
      const eventId = p.eventId;
      const teamId = p.teamId;
      const isFinished = p.event.endView ? p.event.endView < now : false;

      if (!isFinished) return null;

      // Calculate Special Rewards won by this team
      let specialRewardsWon: { name: string; image: string | null; description: string | null }[] =
        [];
      if (teamId) {
        const rewards = await prisma.specialReward.findMany({
          where: { eventId, deletedAt: null },
          include: { votes: { where: { deletedAt: null } } },
        });

        for (const r of rewards) {
          const voteCounts: Record<string, number> = {};
          r.votes.forEach((v) => {
            voteCounts[v.teamId] = (voteCounts[v.teamId] || 0) + 1;
          });

          let maxVotes = 0;
          let winnerTeamId = null;
          for (const [tid, count] of Object.entries(voteCounts)) {
            if (count > maxVotes) {
              maxVotes = count;
              winnerTeamId = tid;
            }
          }

          if (winnerTeamId === teamId && maxVotes > 0) {
            specialRewardsWon.push({
              name: r.name,
              image: r.image,
              description: r.description,
            });
          }
        }
      }

      let rank: number | undefined;

      if (!rank && teamId) {
        const allTeams = await prisma.team.findMany({
          where: { eventId, deletedAt: null },
          include: {
            rewards: { where: { deletedAt: null } },
            categoryRewards: { where: { deletedAt: null } },
          },
        });

        const rankedTeams = withCompetitionRank(sortTeamScores(buildTeamScores(allTeams)));
        const myTeam = rankedTeams.find((team) => team.id === teamId);
        rank = myTeam?.rank;
      }

      const userRating = await prisma.eventRating.findFirst({
        where: {
          userId: user!.id,
          eventId: p.eventId,
          deletedAt: null,
        },
      });

      return {
        eventId: p.event.id,
        eventName: p.event.eventName,
        teamId: p.team?.id,
        teamName: p.team?.teamName || "-",
        place: rank ? rank.toString() : "-",
        specialReward: specialRewardsWon.map((r) => r.name).join(", "),
        specialRewards: specialRewardsWon,
        userRating: userRating ? userRating.rating : null,
      };
    }),
  );

  // 2. Organized
  const organized = await prisma.eventParticipant.findMany({
    where: {
      userId: user?.id,
      eventGroup: "ORGANIZER",
      deletedAt: null,
      event: {
        status: "PUBLISHED",
        publicView: true,
        isHidden: false,
        deletedAt: null,
      },
    },
    include: {
      event: {
        include: {
          ratings: { where: { deletedAt: null } },
        },
      },
    },
    orderBy: {
      event: { createdAt: "desc" },
    },
  });

  const organizedData = organized
    .map((p) => {
      const isFinished = p.event.endView ? p.event.endView < now : false;
      if (!isFinished) return null;

      const ratings = p.event.ratings;
      const avgRating =
        ratings.length > 0
          ? (ratings.reduce((a, b) => a + b.rating, 0) / ratings.length).toFixed(1)
          : "-";

      return {
        eventId: p.event.id,
        eventName: p.event.eventName,
        rating: avgRating,
      };
    })
    .filter((e) => e !== null);

  return c.json({
    message: "ok",
    participated: participatedData.filter((e) => e !== null),
    organized: organizedData,
  });
});

coreRoute.get("/user/:username/history", async (c) => {
  let username = c.req.param("username");
  if (username.startsWith("@")) username = username.substring(1);

  const targetUser = await prisma.user.findFirst({ where: { username, deletedAt: null } });
  if (!targetUser) return c.json({ message: "User not found" }, 404);

  const userId = targetUser.id;
  const now = new Date();

  // 1. Participated (Presenter, Guest, Committee)
  const participated = await prisma.eventParticipant.findMany({
    where: {
      userId: userId,
      eventGroup: { not: "ORGANIZER" },
      deletedAt: null,
      event: {
        status: "PUBLISHED",
        publicView: true,
        isHidden: false,
        deletedAt: null,
      },
    },
    include: {
      event: true,
      team: {
        where: { deletedAt: null },
      },
    },
    orderBy: {
      event: { createdAt: "desc" },
    },
  });

  const participatedData = await Promise.all(
    participated.map(async (p) => {
      const eventId = p.eventId;
      const teamId = p.teamId;
      const isFinished = p.event.endView ? p.event.endView < now : false;

      if (!isFinished) return null;

      // Calculate Special Rewards won by this team
      let specialRewardsWon: { name: string; image: string | null; description: string | null }[] =
        [];
      if (teamId) {
        const rewards = await prisma.specialReward.findMany({
          where: { eventId, deletedAt: null },
          include: { votes: { where: { deletedAt: null } } },
        });

        for (const r of rewards) {
          const voteCounts: Record<string, number> = {};
          r.votes.forEach((v) => {
            voteCounts[v.teamId] = (voteCounts[v.teamId] || 0) + 1;
          });

          let maxVotes = 0;
          let winnerTeamId = null;
          for (const [tid, count] of Object.entries(voteCounts)) {
            if (count > maxVotes) {
              maxVotes = count;
              winnerTeamId = tid;
            }
          }

          if (winnerTeamId === teamId && maxVotes > 0) {
            specialRewardsWon.push({
              name: r.name,
              image: r.image,
              description: r.description,
            });
          }
        }
      }

      let rank: number | undefined;

      if (!rank && teamId) {
        const allTeams = await prisma.team.findMany({
          where: { eventId, deletedAt: null },
          include: {
            rewards: { where: { deletedAt: null } },
            categoryRewards: { where: { deletedAt: null } },
          },
        });

        const rankedTeams = withCompetitionRank(sortTeamScores(buildTeamScores(allTeams)));
        const myTeam = rankedTeams.find((team) => team.id === teamId);
        rank = myTeam?.rank;
      }

      const userRating = await prisma.eventRating.findFirst({
        where: {
          userId: userId,
          eventId: p.eventId,
          deletedAt: null,
        },
      });

      return {
        eventId: p.event.id,
        eventName: p.event.eventName,
        teamId: p.team?.id,
        teamName: p.team?.teamName || "-",
        place: rank ? rank.toString() : "-",
        specialReward: specialRewardsWon.map((r) => r.name).join(", "),
        specialRewards: specialRewardsWon,
        userRating: userRating ? userRating.rating : null,
      };
    }),
  );

  // 2. Organized
  const organized = await prisma.eventParticipant.findMany({
    where: {
      userId: userId,
      eventGroup: "ORGANIZER",
      deletedAt: null,
      event: {
        status: "PUBLISHED",
        publicView: true,
        isHidden: false,
        deletedAt: null,
      },
    },
    include: {
      event: {
        include: {
          ratings: { where: { deletedAt: null } },
        },
      },
    },
    orderBy: {
      event: { createdAt: "desc" },
    },
  });

  const organizedData = organized
    .map((p) => {
      const isFinished = p.event.endView ? p.event.endView < now : false;
      if (!isFinished) return null;

      const ratings = p.event.ratings;
      const avgRating =
        ratings.length > 0
          ? (ratings.reduce((a, b) => a + b.rating, 0) / ratings.length).toFixed(1)
          : "-";

      return {
        eventId: p.event.id,
        eventName: p.event.eventName,
        rating: avgRating,
      };
    })
    .filter((e) => e !== null);

  return c.json({
    message: "ok",
    participated: participatedData.filter((e) => e !== null),
    organized: organizedData,
  });
});

coreRoute.get("/:id", zValidator("param", idParamSchema), async (c) => {
  const user = c.get("user");
  const { id } = c.req.valid("param");

  const event = await prisma.event.findFirst({
    where: { id, deletedAt: null },
    include: {
      fileTypes: { where: { deletedAt: null } },
      vrCategories: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      specialRewards: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
      },
      participants: {
        where: { deletedAt: null },
        include: {
          user: true,
          team: {
            where: { deletedAt: null },
            include: { files: { where: { deletedAt: null } } },
          },
        },
      },
    },
  });
  if (!event) return c.json({ message: "Event not found" }, 404);
  if (event.isHidden) return c.json({ message: "Forbidden" }, 403);

  // For DRAFT events, only organizers can view
  if (event.status === "DRAFT") {
    if (!user) return c.json({ message: "Forbidden" }, 403);
    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", deletedAt: null },
    });
    if (!organizer) return c.json({ message: "Forbidden" }, 403);
  }

  // Calculate Dashboard Stats
  // Filter out participants whose user account is soft-deleted
  const participants = event.participants.filter(p => !p.user.deletedAt);
  const userRoleMap = new Map<string, string>();
  participants.forEach((p) => {
    if (p.eventGroup) userRoleMap.set(p.userId, p.eventGroup);
  });

  const presentersCount = participants.filter((p) => p.eventGroup === "PRESENTER").length;
  const guestsCount = participants.filter((p) => p.eventGroup === "GUEST").length;
  const committeeCount = participants.filter((p) => p.eventGroup === "COMMITTEE").length;

  // Virtual Rewards (Budget)
  const participantsVirtualTotal = participants
    .filter((p) => p.eventGroup === "GUEST")
    .reduce((acc, p) => acc + p.virtualReward, 0);

  const committeeVirtualTotal = participants
    .filter((p) => p.eventGroup === "COMMITTEE")
    .reduce((acc, p) => acc + p.virtualReward, 0);

  const vrTotal = participants.reduce((acc, p) => acc + p.virtualReward, 0);

  // Virtual Rewards (Used)
  const rewardsAgg = await prisma.teamReward.groupBy({
    by: ["giverId"],
    where: { eventId: id, deletedAt: null },
    _sum: { reward: true },
  });

  const categoryRewardsAgg = await prisma.teamRewardCategory.groupBy({
    by: ["giverId"],
    where: { eventId: id, deletedAt: null },
    _sum: { amount: true },
  });

  let participantsVirtualUsed = 0;
  let committeeVirtualUsed = 0;
  let vrUsed = 0;
  let myVirtualUsed = 0;

  const usedByGiver = new Map<string, number>();
  rewardsAgg.forEach((r) => {
    usedByGiver.set(r.giverId, (usedByGiver.get(r.giverId) || 0) + (r._sum.reward || 0));
  });
  categoryRewardsAgg.forEach((r) => {
    usedByGiver.set(r.giverId, (usedByGiver.get(r.giverId) || 0) + (r._sum.amount || 0));
  });

  usedByGiver.forEach((amount, giverId) => {
    vrUsed += amount;
    const role = userRoleMap.get(giverId);
    if (role === "GUEST") participantsVirtualUsed += amount;
    if (role === "COMMITTEE") committeeVirtualUsed += amount;
    if (user && giverId === user.id) myVirtualUsed = amount;
  });

  // Comments / Opinions
  const commentsAgg = await prisma.comment.groupBy({
    by: ["userId"],
    where: { eventId: id, deletedAt: null },
    _count: true,
  });

  let opinionsGot = 0;
  let opinionsPresenter = 0;
  let opinionsGuest = 0;
  let opinionsCommittee = 0;

  commentsAgg.forEach((c) => {
    const count = c._count;
    opinionsGot += count;
    const role = userRoleMap.get(c.userId);
    if (role === "PRESENTER") opinionsPresenter += count;
    if (role === "GUEST") opinionsGuest += count;
    if (role === "COMMITTEE") opinionsCommittee += count;
  });

  // Committee Feedback
  const committeeFeedbackCount = await prisma.committeeFeedback.count({
    where: { eventId: id, deletedAt: null },
  });

  // Special Rewards
  const specialPrizeCount = event.specialRewards.length;

  // Count total votes for stats (regardless of who voted)
  const allVotes = await prisma.specialRewardVote.findMany({
    where: { reward: { eventId: id, deletedAt: null }, deletedAt: null },
    select: { rewardId: true, teamId: true },
  });

  const rewardStats = new Map<string, { votes: number; teams: Set<string> }>();
  allVotes.forEach((v) => {
    if (!rewardStats.has(v.rewardId)) {
      rewardStats.set(v.rewardId, { votes: 0, teams: new Set() });
    }
    const stat = rewardStats.get(v.rewardId)!;
    stat.votes++;
    stat.teams.add(v.teamId);
  });

  const totalSpecialVotes = allVotes.length;
  const specialPrizeUsed = totalSpecialVotes;

  const enhancedSpecialRewards = event.specialRewards.map((r) => {
    const stat = rewardStats.get(r.id) || { votes: 0, teams: new Set() };
    return {
      ...r,
      voteCount: stat.votes,
      teamCount: stat.teams.size,
    };
  });

  // User Specific Stats
  const myParticipant = user ? participants.find((p) => p.userId === user.id) : null;
  const myVirtualTotal = myParticipant?.virtualReward || 0;
  let myFeedbackCount = 0;

  if (myParticipant && myParticipant.eventGroup === "COMMITTEE") {
    myFeedbackCount = await prisma.committeeFeedback.count({
      where: { eventId: id, committeeId: myParticipant.id, deletedAt: null },
    });
  }

  // Unused Awards (for the current user)
  let awardsUnused: typeof event.specialRewards = [];
  if (user) {
    const eligibleRewards =
      myParticipant?.eventGroup === "GUEST"
        ? event.specialRewards.filter((r) => r.allowGuestVote)
        : event.specialRewards;
    const myVotes = await prisma.specialRewardVote.findMany({
      where: {
        reward: { eventId: id, deletedAt: null },
        committeeId: myParticipant?.id,
        deletedAt: null,
      },
      select: { rewardId: true },
    });

    if (myParticipant) {
      // Re-fetch votes using the participant ID
      const myRealVotes = await prisma.specialRewardVote.findMany({
        where: {
          committeeId: myParticipant.id,
          deletedAt: null,
        },
        select: { rewardId: true },
      });

      // Filter out rewards already voted for
      const votedRewardIds = new Set(myRealVotes.map((v) => v.rewardId));
      awardsUnused = eligibleRewards.filter((r) => !votedRewardIds.has(r.id));
    } else {
      awardsUnused = eligibleRewards;
    }
  } else {
    awardsUnused = event.specialRewards;
  }

  const presenterTeams = await prisma.team.count({ where: { eventId: id, deletedAt: null } });

  const enhancedEvent = {
    ...event,
    presentersCount,
    guestsCount,
    committeeCount,
    participantsVirtualTotal,
    participantsVirtualUsed,
    participantsCommentCount: opinionsGuest,
    committeeVirtualTotal,
    committeeVirtualUsed,
    committeeFeedbackCount,
    opinionsGot,
    opinionsPresenter,
    opinionsGuest,
    opinionsCommittee,
    vrTotal,
    vrUsed,
    specialPrizeCount,
    specialPrizeUsed,
    specialRewards: enhancedSpecialRewards,
    awardsUnused,
    presenterTeams,
    myVirtualTotal,
    myVirtualUsed,
    myFeedbackCount,
    myRole: myParticipant?.eventGroup || null,
    myParticipantId: myParticipant?.id || null,
  };

  return c.json({ message: "ok", event: enhancedEvent });
});

export default coreRoute;
