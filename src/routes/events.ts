import { Hono } from "hono";
import { authMiddleware, optionalAuthMiddleware } from "../middlewares/auth.js";
import { getMinio } from "../lib/minio.js";
import { prisma } from "../lib/prisma.js";
import { createHmac } from "crypto";
import sharp from "sharp";
import path from "node:path";
import eventsActionRoute from "./eventsAction.js";
import type { User } from "../generated/prisma/client.js";

const eventsRoute = new Hono<{ Variables: { user: User | null } }>();

eventsRoute.route("/:eventId/action", eventsActionRoute);

eventsRoute.use("*", async (c, next) => {
  const path = c.req.path;
  const method = c.req.method;
  
  // Allow optional auth for GET /api/events/:id (UUID)
  if (method === "GET" && /\/api\/events\/[0-9a-fA-F-]{36}$/.test(path)) {
    return optionalAuthMiddleware(c, next);
  }
  
  return authMiddleware(c as any, next);
});

const INVITE_SECRET = process.env.INVITE_SECRET || "default-secret";
const roleMap = {
  presenter: "PRESENTER",
  guest: "GUEST",
  committee: "COMMITTEE",
} as const;

function signInvite(eventId: string, userId: string, role: keyof typeof roleMap) {
  const payload = `${eventId}|${userId}|${role}`;
  const sig = createHmac("sha256", INVITE_SECRET).update(payload).digest("hex");
  return sig;
}

function verifyInvite(eventId: string, userId: string, role: keyof typeof roleMap, sig: string) {
  const expected = signInvite(eventId, userId, role);
  return expected === sig;
}

eventsRoute.get("/", async (c) => {
  const user = c.get("user");
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED" , publicView: true },
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
      participants: { where: { userId: user?.id }, select: { eventGroup: true, isLeader: true } },
      ratings: { where: { userId: user?.id }, select: { rating: true } },
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

eventsRoute.get("/me", async (c) => {
  const user = c.get("user");
  const events = await prisma.event.findMany({
    where: { status: { not: "DRAFT" }, participants: { some: { userId: user?.id } } },
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
      participants: { where: { userId: user?.id }, select: { eventGroup: true, isLeader: true } },
      ratings: { where: { userId: user?.id }, select: { rating: true } },
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

eventsRoute.get("/me/history", async (c) => {
  const user = c.get("user");
  const now = new Date();

  // 1. Participated (Presenter, Guest, Committee)
  const participated = await prisma.eventParticipant.findMany({
    where: {
      userId: user?.id,
      eventGroup: { not: "ORGANIZER" },
      event: {
        status: "PUBLISHED",
      },
    },
    include: {
      event: true,
      team: {
        include: {
          rankings: true,
        },
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
      let specialRewardsWon: string[] = [];
      if (teamId) {
        const rewards = await prisma.specialReward.findMany({
          where: { eventId },
          include: { votes: true },
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
            specialRewardsWon.push(r.name);
          }
        }
      }

      const rank = p.team?.rankings.find((r) => r.eventId === eventId)?.rank;

      const userRating = await prisma.eventRating.findUnique({
        where: {
          eventId_userId: {
            userId: user!.id,
            eventId: p.eventId,
          },
        },
      });

      return {
        eventId: p.event.id,
        eventName: p.event.eventName,
        teamId: p.team?.id,
        teamName: p.team?.teamName || "-",
        place: rank ? rank.toString() : "-",
        specialReward: specialRewardsWon.length > 0 ? specialRewardsWon.join(", ") : "-",
        userRating: userRating ? userRating.rating : null,
      };
    })
  );

  // 2. Organized
  const organized = await prisma.eventParticipant.findMany({
    where: {
      userId: user?.id,
      eventGroup: "ORGANIZER",
      event: {
        status: "PUBLISHED",
      },
    },
    include: {
      event: {
        include: {
          ratings: true,
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

eventsRoute.get("/:id/presenter/stats", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  // 1. Find user's team in this event
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId,
      userId: user.id,
      eventGroup: "PRESENTER",
    },
    include: { team: true },
  });

  if (!participant || !participant.teamId) {
    return c.json({ message: "You are not a presenter in a team for this event" }, 404);
  }

  const teamId = participant.teamId;

  // 2. Calculate Rank & Score
  const allTeams = await prisma.team.findMany({
    where: { eventId },
    include: { rewards: true },
  });

  const teamScores = allTeams.map((t) => ({
    id: t.id,
    score: t.rewards.reduce((acc, r) => acc + r.reward, 0),
  }));

  // Sort descending
  teamScores.sort((a, b) => b.score - a.score);

  const myRankIndex = teamScores.findIndex((t) => t.id === teamId);
  const myRank = myRankIndex !== -1 ? myRankIndex + 1 : "-";
  const myScore = teamScores.find((t) => t.id === teamId)?.score || 0;

  // 3. Comments Breakdown
  const comments = await prisma.comment.findMany({
    where: { teamId, eventId },
    include: {
      user: {
        include: {
          participants: {
            where: { eventId },
          },
        },
      },
    },
  });

  let commentTotal = 0;
  let commentGuest = 0;
  let commentCommittee = 0;

  comments.forEach((cm) => {
    commentTotal++;
    const role = cm.user.participants[0]?.eventGroup;
    if (role === "GUEST") commentGuest++;
    if (role === "COMMITTEE") commentCommittee++;
  });

  // 4. Special Rewards Votes
  const allSpecialRewards = await prisma.specialReward.findMany({
    where: { eventId },
  });

  const specialVotes = await prisma.specialRewardVote.findMany({
    where: { teamId },
  });

  const voteCounts: Record<string, number> = {};
  specialVotes.forEach((v) => {
    voteCounts[v.rewardId] = (voteCounts[v.rewardId] || 0) + 1;
  });

  const specialRewards = allSpecialRewards.map((r) => ({
    name: r.name,
    image: r.image,
    count: voteCounts[r.id] || 0,
  }));

  return c.json({
    message: "ok",
    stats: {
      rank: myRank,
      score: myScore,
      comments: {
        total: commentTotal,
        guest: commentGuest,
        committee: commentCommittee,
      },
      specialRewards,
    },
  });
});

eventsRoute.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      fileTypes: true,
      specialRewards: true,
      participants: { include: { user: true, team: { include: { files: true } } } },
    },
  });
  if (!event) return c.json({ message: "Event not found" }, 404);

  // For DRAFT events, only organizers can view
  if (event.status === "DRAFT") {
    if (!user) return c.json({ message: "Forbidden" }, 403);
    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER" },
    });
    if (!organizer) return c.json({ message: "Forbidden" }, 403);
  } 
  // For non-public events, only participants can view
  else if (!event.publicView) {
    if (!user) return c.json({ message: "Forbidden" }, 403);
    const participant = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: user.id },
    });
    if (!participant) return c.json({ message: "Forbidden" }, 403);
  }
  // Otherwise, it's a PUBLISHED public event - allow everyone (including unauthenticated)

  // Calculate Dashboard Stats
  const participants = event.participants;
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
    where: { eventId: id },
    _sum: { reward: true },
  });

  let participantsVirtualUsed = 0;
  let committeeVirtualUsed = 0;
  let vrUsed = 0;
  let myVirtualUsed = 0;

  rewardsAgg.forEach((r) => {
    const amount = r._sum.reward || 0;
    vrUsed += amount;
    const role = userRoleMap.get(r.giverId);
    if (role === "GUEST") participantsVirtualUsed += amount;
    if (role === "COMMITTEE") committeeVirtualUsed += amount;
    if (user && r.giverId === user.id) myVirtualUsed = amount;
  });

  // Comments / Opinions
  const commentsAgg = await prisma.comment.groupBy({
    by: ["userId"],
    where: { eventId: id },
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
    where: { eventId: id },
  });
  
  // Special Rewards
  const specialPrizeCount = event.specialRewards.length;
  
  // Count total votes for stats (regardless of who voted)
  const allVotes = await prisma.specialRewardVote.findMany({
    where: { reward: { eventId: id } },
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
      where: { eventId: id, committeeId: myParticipant.id },
    });
  }

  // Unused Awards (for the current user)
  let awardsUnused: typeof event.specialRewards = [];
  if (user) {
    const myVotes = await prisma.specialRewardVote.findMany({
      where: { 
        reward: { eventId: id },
        committeeId: myParticipant?.id 
      },
      select: { rewardId: true },
    });
    
    if (myParticipant) {
       // Re-fetch votes using the participant ID
       const myRealVotes = await prisma.specialRewardVote.findMany({
         where: {
            committeeId: myParticipant.id
         },
         select: { rewardId: true }
       });
       
       // Filter out rewards already voted for
       const votedRewardIds = new Set(myRealVotes.map((v) => v.rewardId));
       awardsUnused = event.specialRewards.filter((r) => !votedRewardIds.has(r.id));
    } else {
       awardsUnused = event.specialRewards;
    }
  } else {
     awardsUnused = event.specialRewards;
  }

  const presenterTeams = await prisma.team.count({ where: { eventId: id } });

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
  };

  return c.json({ message: "ok", event: enhancedEvent });
});

eventsRoute.get("/:id/rankings", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      specialRewards: {
        include: {
          votes: true,
        },
      },
    },
  });

  if (!event) return c.json({ message: "Event not found" }, 404);
  if (event.status !== "PUBLISHED") return c.json({ message: "Event not published" }, 403);

  // Check permission
  let canView = event.publicView;
  if (!canView && user) {
    const p = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user.id },
    });
    if (p) canView = true;
  }
  if (!canView) return c.json({ message: "Forbidden" }, 403);

  // Fetch Teams & Calculate VR Scores
  const teams = await prisma.team.findMany({
    where: { eventId },
    include: {
      rewards: true,
    },
  });

  const teamScores = teams.map((team) => {
    const totalReward = team.rewards.reduce((sum, r) => sum + r.reward, 0);
    return {
      id: team.id,
      name: team.teamName,
      totalReward,
      imageCover: team.imageCover,
    };
  });

  // Sort by Total Reward (Desc)
  teamScores.sort((a, b) => b.totalReward - a.totalReward);

  // Assign Rank
  const rankings = teamScores.map((t, index) => ({
    ...t,
    rank: index + 1,
  }));

  // Special Rewards Winners
  const specialRewards = event.specialRewards.map((reward) => {
    const voteCounts: Record<string, number> = {};
    reward.votes.forEach((v) => {
      voteCounts[v.teamId] = (voteCounts[v.teamId] || 0) + 1;
    });

    let maxVotes = 0;
    let winnerTeamId: string | null = null;

    Object.entries(voteCounts).forEach(([teamId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        winnerTeamId = teamId;
      }
    });

    const winnerTeam = winnerTeamId ? teams.find((t) => t.id === winnerTeamId) : null;

    return {
      id: reward.id,
      name: reward.name,
      image: reward.image,
      winner: winnerTeam
        ? {
            id: winnerTeam.id,
            name: winnerTeam.teamName,
            votes: maxVotes,
          }
        : null,
    };
  });

  return c.json({
    message: "ok",
    rankings,
    specialRewards,
  });
});

eventsRoute.get("/:id/invite/sign", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const role = c.req.query("role") as keyof typeof roleMap | undefined;
  if (!role || !(role in roleMap)) return c.json({ message: "invalid role" }, 400);
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PUBLISHED") return c.json({ message: "Event not found" }, 404);
  const existing = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user.id },
  });
  if (existing) return c.json({ message: "Already joined" }, 400);
  const sig = signInvite(eventId, user.id, role);
  return c.json({ message: "ok", sig });
});

eventsRoute.get("/:id/invite/token", async (c) => {
  const eventId = c.req.param("id");
  const role = c.req.query("role") as keyof typeof roleMap | undefined;
  if (!role || !(role in roleMap)) return c.json({ message: "invalid role" }, 400);
  
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PUBLISHED") return c.json({ message: "Event not found" }, 404);
  
  let linkInvite = await prisma.linkInvite.findUnique({ where: { eventId } });
  if (!linkInvite) {
    linkInvite = await prisma.linkInvite.create({
      data: { eventId },
    });
  }

  let token = "";
  if (role === "committee") token = linkInvite.committeeToken;
  else if (role === "presenter") token = linkInvite.presenterToken;
  else if (role === "guest") token = linkInvite.guestToken;

  return c.json({ message: "ok", token });
});

eventsRoute.post("/:id/invite/token/refresh", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const role = c.req.query("role") as keyof typeof roleMap | undefined;
  if (!role || !(role in roleMap)) return c.json({ message: "invalid role" }, 400);

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PUBLISHED") return c.json({ message: "Event not found" }, 404);

  // Check if user is an organizer
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  let linkInvite = await prisma.linkInvite.findUnique({ where: { eventId } });
  if (!linkInvite) {
    linkInvite = await prisma.linkInvite.create({
      data: { eventId },
    });
  }

  // Update token for specific role
  const updatedLinkInvite = await prisma.linkInvite.update({
    where: { eventId },
    data: {
      committeeToken: role === "committee" ? crypto.randomUUID() : undefined,
      presenterToken: role === "presenter" ? crypto.randomUUID() : undefined,
      guestToken: role === "guest" ? crypto.randomUUID() : undefined,
    },
  });

  let token = "";
  if (role === "committee") token = updatedLinkInvite.committeeToken;
  else if (role === "presenter") token = updatedLinkInvite.presenterToken;
  else if (role === "guest") token = updatedLinkInvite.guestToken;

  return c.json({ message: "ok", token });
});

// Preview invite (no auth required). Returns role if the token/role is valid for this event.
eventsRoute.get("/:id/invite/preview", async (c) => {
  const eventId = c.req.param("id");
  const token = c.req.query("token") || "";
  const roleParam = c.req.query("role") as keyof typeof roleMap | undefined;
  
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PUBLISHED") return c.json({ message: "Event not found" }, 404);
  
  if (token) {
    const linkInvite = await prisma.linkInvite.findUnique({ where: { eventId } });
    if (!linkInvite) return c.json({ message: "invalid token" }, 400);
    
    let role: keyof typeof roleMap | null = null;
    if (linkInvite.committeeToken === token) role = "committee";
    else if (linkInvite.presenterToken === token) role = "presenter";
    else if (linkInvite.guestToken === token) role = "guest";
    
    if (!role) return c.json({ message: "invalid token" }, 400);
    return c.json({ message: "ok", role: role });
  }
  
  if (!roleParam || !(roleParam in roleMap)) return c.json({ message: "invalid role" }, 400);
  return c.json({ message: "ok", role: roleParam });
});

eventsRoute.post("/:id/invite", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const token = c.req.query("token") || "";
  let role = c.req.query("role") as keyof typeof roleMap | undefined;
  const sig = c.req.query("sig") || "";
  
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.status !== "PUBLISHED") return c.json({ message: "Event not found" }, 404);
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  
  const existing = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });
  if (existing) return c.json({ message: "Already joined" }, 400);

  let targetRole: "ORGANIZER" | "PRESENTER" | "GUEST" | "COMMITTEE" | undefined;

  if (token) {
    const linkInvite = await prisma.linkInvite.findUnique({ where: { eventId } });
    if (!linkInvite) return c.json({ message: "invalid token" }, 400);

    if (linkInvite.committeeToken === token) targetRole = "COMMITTEE";
    else if (linkInvite.presenterToken === token) targetRole = "PRESENTER";
    else if (linkInvite.guestToken === token) targetRole = "GUEST";
    else return c.json({ message: "invalid token" }, 400);

  } else {
    if (!role || !(role in roleMap)) return c.json({ message: "invalid role" }, 400);
    if (!verifyInvite(eventId, user.id, role, sig)) return c.json({ message: "invalid signature" }, 400);
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
      // Allow if in viewSoon (after endJoinDate but before startView)
      if (!event.endJoinDate || now <= event.endJoinDate) {
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
});

eventsRoute.get("/:id/participants", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  const participants = await prisma.eventParticipant.findMany({
    where: { eventId: id },
    include: { user: true, team: { include: { files: true } } },
  });

  const rewards = await prisma.teamReward.groupBy({
    by: ["giverId"],
    where: { eventId: id },
    _sum: { reward: true },
  });

  const rewardMap = new Map(rewards.map((r) => [r.giverId, r._sum.reward || 0]));

  const participantsWithUsage = participants.map((p) => ({
    ...p,
    virtualUsed: rewardMap.get(p.userId) || 0,
  }));

  return c.json({ message: "ok", participants: participantsWithUsage });
});

eventsRoute.put("/:id/participants/:pid", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const data: {
    eventGroup?: "ORGANIZER" | "PRESENTER" | "COMMITTEE" | "GUEST";
    isLeader?: boolean;
    virtualReward?: number;
    teamId?: string | null;
  } = {};
  const eg = body?.eventGroup;
  if (eg && ["ORGANIZER", "PRESENTER", "COMMITTEE", "GUEST"].includes(eg)) {
    data.eventGroup = eg;
    
    // Auto-update virtual reward based on role
    const event = await prisma.event.findUnique({ where: { id } });
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
  
  const existing = await prisma.eventParticipant.findFirst({ where: { id: pid, eventId: id } });
  if (!existing) return c.json({ message: "Participant not found" }, 404);

  // If role changes, reset scores/rewards given by this user
  if (data.eventGroup && data.eventGroup !== existing.eventGroup) {
      // 1. Delete Virtual Rewards (TeamReward) given by this user in this event
      await prisma.teamReward.deleteMany({
          where: {
              eventId: id,
              giverId: existing.userId
          }
      });

      // 2. Delete Special Rewards (SpecialRewardVote) given by this committee (participant)
      // Note: SpecialRewardVote uses committeeId which is the participant ID
      await prisma.specialRewardVote.deleteMany({
          where: {
              committeeId: pid // pid is existing.id
          }
      });
  }

  if (typeof body?.isLeader === "boolean") data.isLeader = body.isLeader;
  if (typeof body?.virtualReward === "number") data.virtualReward = Math.max(0, body.virtualReward);
  if (body?.teamId === null) data.teamId = null;
  else if (typeof body?.teamId === "string" && body.teamId.length > 0) data.teamId = body.teamId;

  if (existing.eventGroup === "ORGANIZER") {
    if (!organizer.isLeader) {
      return c.json({ message: "Only organizer leader can manage organizer group" }, 403);
    }
    if (existing.userId === user?.id) {
      return c.json({ message: "Organizer leader cannot manage self" }, 403);
    }
    if (typeof body?.isLeader === "boolean") {
      return c.json({ message: "Cannot change organizer leader flag" }, 403);
    }
  } else {
    if (!organizer.isLeader && body?.eventGroup === "ORGANIZER") {
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
        await prisma.team.delete({ where: { id: existing.teamId } });
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
});

eventsRoute.delete("/:id/participants/:pid", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  const existing = await prisma.eventParticipant.findFirst({ where: { id: pid, eventId: id } });
  if (!existing) return c.json({ message: "Participant not found" }, 404);
  if (existing.eventGroup === "ORGANIZER") {
    if (!organizer.isLeader) return c.json({ message: "Only organizer leader can delete organizer" }, 403);
    if (existing.userId === user?.id) {
      return c.json({ message: "Organizer leader cannot delete self" }, 403);
    }
  }
  await prisma.eventParticipant.delete({ where: { id: pid } });
  return c.json({ message: "ok" });
});

eventsRoute.post("/:id/teams", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const contentType = c.req.header("content-type") || "";
  let teamName: string | undefined;
  let description: string | undefined;
  let videoLink: string | undefined;
  let imageCover: string | undefined;
  let file: File | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    teamName = typeof form["teamName"] === "string" ? form["teamName"] : undefined;
    description = typeof form["description"] === "string" ? form["description"] : undefined;
    file = form["imageCover"] instanceof File ? (form["imageCover"] as File) : undefined;
  } else {
    const body = await c.req.json().catch(() => ({}));
    teamName = body.teamName;
    description = body.description;
    imageCover = body.imageCover;
  }

  if (!teamName || typeof teamName !== "string" || teamName.trim().length < 1) {
    return c.json({ message: "Team name is required" }, 400);
  }

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });
  if (!participant) return c.json({ message: "Forbidden" }, 403);

  if (participant.teamId) {
    return c.json({ message: "You are already in a team" }, 400);
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return c.json({ message: "Event not found" }, 404);

  if (event.maxTeams) {
    const currentTeams = await prisma.team.count({ where: { eventId } });
    if (currentTeams >= event.maxTeams) {
      return c.json({ message: "Max teams reached for this event" }, 400);
    }
  }

  if (file) {
    const minio = getMinio();
    const bucket = process.env.OBJ_BUCKET!;
    const baseName = path.parse(file.name).name;
    const objectName = `teams/covers/${eventId}-${Date.now()}-${baseName}.webp`;
    const buffer = Buffer.from(await file.arrayBuffer());
    // Optional: resize/convert to webp if sharp is available
    const webpBuffer = await sharp(buffer).webp().toBuffer();
    await minio.putObject(bucket, objectName, webpBuffer);
    imageCover = `/backend/files/${bucket}/${objectName}`;
  }

  const team = await prisma.team.create({
    data: {
      eventId,
      teamName: teamName.trim(),
      description,
      videoLink,
      imageCover,
    },
  });

  await prisma.eventParticipant.update({
    where: { id: participant.id },
    data: { teamId: team.id, isLeader: true },
  });

  return c.json({ message: "ok", team });
});

eventsRoute.put("/:id/teams/:teamId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");
  const contentType = c.req.header("content-type") || "";
  let teamName: string | undefined;
  let description: string | undefined;
  let imageCover: string | undefined;
  let file: File | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    teamName = typeof form["teamName"] === "string" ? form["teamName"] : undefined;
    description = typeof form["description"] === "string" ? form["description"] : undefined;
    file = form["imageCover"] instanceof File ? (form["imageCover"] as File) : undefined;
    // Check if imageCover is sent as string (e.g. "null" or existing url)
    if (typeof form["imageCover"] === "string") imageCover = form["imageCover"];
  } else {
    const body = await c.req.json().catch(() => ({}));
    teamName = body.teamName;
    description = body.description;
    imageCover = body.imageCover;
  }
  
  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });

  // Permission Check:
  // Only the Leader of THIS team can edit.
  if (!participant) return c.json({ message: "Forbidden" }, 403);

  const isTeamLeader = participant.teamId === teamId && participant.isLeader;

  if (!isTeamLeader) {
    return c.json({ message: "Forbidden" }, 403);
  }

  if (file) {
    const minio = getMinio();
    const bucket = process.env.OBJ_BUCKET!;
    const baseName = path.parse(file.name).name;
    const objectName = `imgCoverTeam/${eventId}-${Date.now()}-${baseName}.webp`;
    const buffer = Buffer.from(await file.arrayBuffer());
    // Optional: resize/convert to webp if sharp is available
    const webpBuffer = await sharp(buffer).webp().toBuffer();
    await minio.putObject(bucket, objectName, webpBuffer);
    imageCover = `/backend/files/${bucket}/${objectName}`;
  }

  const data: any = {};
  if (typeof teamName === "string" && teamName.trim().length > 0) data.teamName = teamName.trim();
  if (typeof description === "string") data.description = description;
  if (typeof imageCover === "string") data.imageCover = imageCover === "null" ? null : imageCover;

  const team = await prisma.team.update({
    where: { id: teamId },
    data,
  });

  return c.json({ message: "ok", team });
});

eventsRoute.get("/:id/presenters/candidates", async (c) => {
  const eventId = c.req.param("id");
  const q = c.req.query("q") || "";

  if (q.length < 2) return c.json({ message: "ok", candidates: [] });

  const candidates = await prisma.eventParticipant.findMany({
    where: {
      eventId,
      eventGroup: "PRESENTER",
      teamId: null,
      user: {
        OR: [
          { name: { contains: q } }, // Case insensitive usually depends on DB collation, or use mode: 'insensitive' for Postgres
          { username: { contains: q } },
        ],
      },
    },
    include: { user: true },
    take: 10,
  });

  return c.json({
    message: "ok",
    candidates: candidates.map((c) => ({
      id: c.id,
      userId: c.userId,
      name: c.user.name,
      username: c.user.username,
      image: c.user.image,
    })),
  });
});

eventsRoute.post("/:id/teams/:teamId/members", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");
  const { userId } = await c.req.json();

  const requester = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });

  if (!requester || requester.teamId !== teamId) {
    return c.json({ message: "Forbidden" }, 403);
  }

  // Only leader can add members
  if (!requester.isLeader) {
    return c.json({ message: "Only leader can add members" }, 403);
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return c.json({ message: "Event not found" }, 404);

  if (event.maxTeamMembers !== null && event.maxTeamMembers !== undefined) {
    const currentMembers = await prisma.eventParticipant.count({
      where: { teamId },
    });
    if (currentMembers >= event.maxTeamMembers) {
      return c.json({ message: "Max team members reached" }, 400);
    }
  }

  const target = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: userId },
  });

  if (!target) return c.json({ message: "User not found in event" }, 404);
  if (target.teamId) return c.json({ message: "User already in a team" }, 400);
  if (target.eventGroup !== "PRESENTER") return c.json({ message: "User is not a presenter" }, 400);

  await prisma.eventParticipant.update({
    where: { id: target.id },
    data: { teamId },
  });

  return c.json({ message: "ok" });
});

eventsRoute.get("/:id/teams/:teamId/comments", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user.id },
    include: { team: true },
  });

  if (!participant) return c.json({ message: "Forbidden" }, 403);

  let comments: any[] = [];

  // 1. Team Members & Organizer see all comments from Committee/Guest
  if (participant.teamId === teamId || participant.eventGroup === "ORGANIZER") {
    comments = await prisma.comment.findMany({
      where: {
        eventId,
        teamId,
        user: {
          participants: {
            some: {
              eventId,
              eventGroup: { in: ["COMMITTEE", "GUEST"] },
            },
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            participants: {
              where: { eventId },
              select: { eventGroup: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  } else if (["COMMITTEE", "GUEST"].includes(participant.eventGroup || "")) {
    // 2. Committee/Guest see only their own comment
    comments = await prisma.comment.findMany({
      where: {
        eventId,
        teamId,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            participants: {
              where: { eventId },
              select: { eventGroup: true },
            },
          },
        },
      },
    });
  }

  const formattedComments = comments.map((comment) => ({
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    user: {
      id: comment.user.id,
      name: comment.user.name,
      image: comment.user.image,
      role: comment.user.participants[0]?.eventGroup || "UNKNOWN",
    },
  }));

  return c.json({ message: "ok", comments: formattedComments });
});

eventsRoute.get("/:id/teams/:teamId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");

  try {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        participants: { include: { user: true } },
        files: { include: { fileType: true } },
      },
    });

    if (!team || team.eventId !== eventId) {
      return c.json({ message: "Team not found" }, 404);
    }

    // Get My Rewards info
    let myReward = 0;
    let mySpecialRewards: string[] = [];
    let myComment = "";

    if (user) {
        const reward = await prisma.teamReward.findFirst({
            where: { eventId, teamId, giverId: user.id }
        });
        if (reward) myReward = reward.reward;

        const myParticipant = await prisma.eventParticipant.findFirst({
            where: { eventId, userId: user.id, eventGroup: "COMMITTEE" }
        });

        if (myParticipant) {
            const myVotes = await prisma.specialRewardVote.findMany({
                where: { committeeId: myParticipant.id, teamId },
                select: { rewardId: true }
            });
            mySpecialRewards = myVotes.map(v => v.rewardId);
        }

        const comment = await prisma.comment.findFirst({
            where: { eventId, teamId, userId: user.id }
        });
        if (comment) myComment = comment.content;
    }

    // Get Total VR
    const totalReward = await prisma.teamReward.aggregate({
        where: { eventId, teamId },
        _sum: { reward: true }
    });
    const totalVr = totalReward._sum.reward || 0;

    return c.json({ 
        message: "ok", 
        team: {
            ...team,
            totalVr,
            myReward,
            mySpecialRewards,
            myComment
        } 
    });
  } catch (error) {
    console.error("Error fetching team:", error);
    return c.json({ message: "Team not found or invalid ID" }, 404);
  }
});

eventsRoute.delete("/:id/teams/:teamId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });
  // Only leader can delete
  if (!participant || participant.teamId !== teamId || !participant.isLeader) {
     // Or organizer?
     const organizer = await prisma.eventParticipant.findFirst({
        where: { eventId, userId: user?.id, eventGroup: "ORGANIZER" },
     });
     if (!organizer) return c.json({ message: "Forbidden" }, 403);
  }

  // Unlink participants first to prevent cascade delete
  await prisma.eventParticipant.updateMany({
    where: { teamId },
    data: { teamId: null, isLeader: false },
  });

  await prisma.team.delete({
    where: { id: teamId },
  });

  return c.json({ message: "ok" });
});

eventsRoute.get("/:id/teams", async (c) => {
  const eventId = c.req.param("id");
  const teams = await prisma.team.findMany({
    where: { eventId },
    include: {
      participants: { include: { user: true } },
      files: { include: { fileType: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rewards = await prisma.teamReward.groupBy({
    by: ["teamId"],
    where: { eventId },
    _sum: { reward: true },
  });

  const rewardMap = new Map<string, number>();
  rewards.forEach((r) => {
    rewardMap.set(r.teamId, r._sum.reward || 0);
  });

  const user = c.get("user");
  const myRewardsMap = new Map<string, number>();
  const mySpecialRewardsMap = new Map<string, string[]>();

  if (user) {
    const myRewards = await prisma.teamReward.findMany({
      where: { eventId, giverId: user.id },
    });
    myRewards.forEach((r) => {
      myRewardsMap.set(r.teamId, r.reward);
    });

    const myParticipant = await prisma.eventParticipant.findFirst({
        where: { eventId, userId: user.id, eventGroup: "COMMITTEE" }
    });

    if (myParticipant) {
        const myVotes = await prisma.specialRewardVote.findMany({
            where: { committeeId: myParticipant.id },
            include: { reward: true }
        });
        myVotes.forEach(v => {
            if (v.teamId) {
                const existing = mySpecialRewardsMap.get(v.teamId) || [];
                existing.push(v.reward.id); // Use ID for easier frontend matching
                mySpecialRewardsMap.set(v.teamId, existing);
            }
        });
    }
  }

  const teamsWithVr = teams.map((t) => ({
    ...t,
    totalVr: rewardMap.get(t.id) || 0,
    myReward: myRewardsMap.get(t.id) || 0,
    mySpecialRewards: mySpecialRewardsMap.get(t.id) || [],
  }));

  return c.json({ message: "ok", teams: teamsWithVr });
});

eventsRoute.post("/:id/teams/:teamId/files", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });
  if (!participant || participant.teamId !== teamId) {
    return c.json({ message: "Forbidden" }, 403);
  }

  const form = await c.req.parseBody();
  const fileTypeId = form["fileTypeId"] as string;
  const file = form["file"] as File | undefined;
  const url = form["url"] as string | undefined;

  if (!fileTypeId || (!file && !url)) {
    return c.json({ message: "Missing file or url or fileTypeId" }, 400);
  }

  const fileType = await prisma.eventFileType.findFirst({
    where: { id: fileTypeId, eventId },
  });
  if (!fileType) return c.json({ message: "Invalid file type" }, 400);

  // Check if file already exists for this team and fileType
  const existingFile = await prisma.teamFile.findFirst({
    where: { teamId, fileTypeId },
  });

  if (existingFile) {
    // Delete existing record (MinIO file deletion is optional/deferred, but we remove DB record)
    await prisma.teamFile.delete({
      where: { id: existingFile.id },
    });
  }

  let fileUrl = "";
  if (file) {
    const minio = getMinio();
    const bucket = process.env.OBJ_BUCKET!;
    const ext = path.extname(file.name);
    const objectName = `teams/${teamId}/${fileTypeId}-${Date.now()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await minio.putObject(bucket, objectName, buffer);
    fileUrl = `/backend/files/${bucket}/${objectName}`;
  } else if (url) {
    fileUrl = url;
  }

  const teamFile = await prisma.teamFile.create({
    data: {
      teamId,
      fileTypeId,
      fileUrl,
    },
  });

  return c.json({ message: "ok", teamFile });
});

eventsRoute.delete("/:id/teams/:teamId/files/:fileTypeId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");
  const fileTypeId = c.req.param("fileTypeId");

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });
  if (!participant || participant.teamId !== teamId) {
    return c.json({ message: "Forbidden" }, 403);
  }

  // Allow any team member to delete, matching upload permissions
  await prisma.teamFile.deleteMany({
    where: { teamId, fileTypeId },
  });

  return c.json({ message: "ok" });
});

eventsRoute.delete("/:id/teams/:teamId/members/:userId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");
  const targetUserId = c.req.param("userId");

  const requester = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });

  if (!requester || requester.teamId !== teamId) {
    return c.json({ message: "Forbidden" }, 403);
  }

  if (!requester.isLeader && user?.id !== targetUserId) {
    return c.json({ message: "Only leader can remove other members" }, 403);
  }

  const target = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: targetUserId },
  });

  if (!target || target.teamId !== teamId) {
    return c.json({ message: "User not in this team" }, 404);
  }

  if (target.isLeader) {
     return c.json({ message: "Cannot remove leader" }, 400);
  }

  await prisma.eventParticipant.update({
    where: { id: target.id },
    data: { teamId: null },
  });

  return c.json({ message: "ok" });
});

eventsRoute.get("/me/drafts", async (c) => {
  const user = c.get("user");
  const drafts = await prisma.event.findMany({
    where: {
      status: "DRAFT",
      participants: { some: { userId: user?.id, eventGroup: "ORGANIZER", isLeader: true } },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, eventName: true, createdAt: true, imageCover: true },
  });
  return c.json({ message: "ok", events: drafts });
});

eventsRoute.get("/check-name", async (c) => {
  const eventName = c.req.query("eventName");
  if (!eventName || typeof eventName !== "string" || eventName.trim().length < 1) {
    return c.json({ message: "eventName is required" }, 400);
  }
  const exists = await prisma.event.findFirst({
    where: { eventName: { equals: eventName.trim(), mode: "insensitive" } },
  });
  return c.json({ message: "ok", available: !exists });
});

eventsRoute.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const eventName = body.eventName;
  if (!eventName || typeof eventName !== "string" || eventName.trim().length < 1) {
    return c.json({ message: "Event name is required" }, 400);
  }
  const normalizedName = eventName.trim();
  const exists = await prisma.event.findFirst({
    where: { eventName: { equals: normalizedName, mode: "insensitive" } },
  });
  if (exists) return c.json({ message: "Event name already exists" }, 409);
  const event = await prisma.event.create({ data: { eventName: normalizedName, status: "DRAFT" } });
  await prisma.eventParticipant.create({
    data: { eventId: event.id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true },
  });
  return c.json({ message: "ok", event });
});

eventsRoute.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  const contentType = c.req.header("content-type") || "";
  let data: any = {};
  let newName: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    newName = typeof form["eventName"] === "string" ? (form["eventName"] as string) : undefined;
    if (newName) {
      const trimmed = newName.trim();
      if (!trimmed.length) {
        return c.json({ message: "Event name is required" }, 400);
      }
      const dup = await prisma.event.findFirst({
        where: {
          id: { not: id },
          eventName: { equals: trimmed, mode: "insensitive" },
        },
      });
      if (dup) return c.json({ message: "Event name already exists" }, 409);
      newName = trimmed;
    }

    data.eventName = newName ?? event.eventName;
    if (typeof form["eventDescription"] === "string") data.eventDescription = form["eventDescription"] as string;
    if (typeof form["locationName"] === "string") data.locationName = form["locationName"] as string;
    if (typeof form["location"] === "string") data.location = form["location"] as string;
    if (typeof form["publicView"] === "string") data.publicView = (form["publicView"] as string) === "true";
    if (typeof form["hasCommittee"] === "string") data.hasCommittee = (form["hasCommittee"] as string) === "true";
    if (typeof form["currentStep"] === "string") {
      const cs = parseInt(form["currentStep"] as string);
      if (!Number.isNaN(cs)) data.currentStep = cs;
    }
    if (typeof form["startView"] === "string" && (form["startView"] as string).length > 0)
      data.startView = new Date(form["startView"] as string);
    if (typeof form["endView"] === "string" && (form["endView"] as string).length > 0)
      data.endView = new Date(form["endView"] as string);
    if (typeof form["startJoinDate"] === "string" && (form["startJoinDate"] as string).length > 0)
      data.startJoinDate = new Date(form["startJoinDate"] as string);
    if (typeof form["endJoinDate"] === "string" && (form["endJoinDate"] as string).length > 0)
      data.endJoinDate = new Date(form["endJoinDate"] as string);
    if (typeof form["maxTeamMembers"] === "string") {
      const n = parseInt(form["maxTeamMembers"] as string);
      if (!Number.isNaN(n)) data.maxTeamMembers = n;
    }
    if (typeof form["maxTeams"] === "string") {
      const n = parseInt(form["maxTeams"] as string);
      if (!Number.isNaN(n)) data.maxTeams = n;
    }
    if (typeof form["virtualRewardGuest"] === "string") {
      const n = parseInt(form["virtualRewardGuest"] as string);
      if (!Number.isNaN(n)) data.virtualRewardGuest = n;
    }
    if (typeof form["virtualRewardCommittee"] === "string") {
      const n = parseInt(form["virtualRewardCommittee"] as string);
      if (!Number.isNaN(n)) data.virtualRewardCommittee = n;
    }
    if (typeof form["unitReward"] === "string") {
      data.unitReward = String(form["unitReward"]);
    }

    const file = form["file"] as File | undefined;
    const imgNull = form["imageCover"];
    if (imgNull === "null") {
      data.imageCover = null;
    }
    if (file) {
      const minio = getMinio();
      const bucket = process.env.OBJ_BUCKET!;
      const baseName = path.parse(file.name).name;
      const objectName = `event-covers/${id}-${Date.now()}-${baseName}.webp`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const webpBuffer = await sharp(buffer).webp().toBuffer();
      await minio.putObject(bucket, objectName, webpBuffer);
      data.imageCover = `/backend/files/${bucket}/${objectName}`;
    }
  } else {
    const body = await c.req.json().catch(() => ({}));
    newName = typeof body.eventName === "string" ? body.eventName : undefined;
    if (newName) {
      const trimmed = newName.trim();
      if (!trimmed.length) {
        return c.json({ message: "Event name is required" }, 400);
      }
      const dup = await prisma.event.findFirst({
        where: {
          id: { not: id },
          eventName: { equals: trimmed, mode: "insensitive" },
        },
      });
      if (dup) return c.json({ message: "Event name already exists" }, 409);
      newName = trimmed;
    }
    data = {
      eventName: newName ?? event.eventName,
      eventDescription: body.eventDescription ?? event.eventDescription,
      locationName: body.locationName ?? event.locationName,
      location: body.location ?? event.location,
      publicView: typeof body.publicView === "boolean" ? body.publicView : event.publicView,
      startView: body.startView ? new Date(body.startView) : event.startView,
      endView: body.endView ? new Date(body.endView) : event.endView,
      startJoinDate: body.startJoinDate ? new Date(body.startJoinDate) : event.startJoinDate,
      endJoinDate: body.endJoinDate ? new Date(body.endJoinDate) : event.endJoinDate,
      maxTeamMembers: typeof body.maxTeamMembers === "number" ? body.maxTeamMembers : event.maxTeamMembers,
      maxTeams: typeof body.maxTeams === "number" ? body.maxTeams : event.maxTeams,
      virtualRewardGuest: typeof body.virtualRewardGuest === "number" ? body.virtualRewardGuest : event.virtualRewardGuest,
      virtualRewardCommittee: typeof body.virtualRewardCommittee === "number" ? body.virtualRewardCommittee : event.virtualRewardCommittee,
      hasCommittee: typeof body.hasCommittee === "boolean" ? body.hasCommittee : event.hasCommittee,
      unitReward: typeof body.unitReward === "string" ? body.unitReward : event.unitReward,
    } as any;
    if ("imageCover" in body) (data as any).imageCover = body.imageCover === "null" ? null : body.imageCover;
  }

  // Handle fileTypes sync
  let fileTypesData: any[] | undefined;
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    if (typeof form["fileTypes"] === "string") {
      try {
        fileTypesData = JSON.parse(form["fileTypes"] as string);
      } catch (e) {}
    }
  } else {
    const body = await c.req.json().catch(() => ({}));
    if (Array.isArray(body.fileTypes)) {
      fileTypesData = body.fileTypes;
    }
  }

  if (fileTypesData) {
    const current = await prisma.eventFileType.findMany({ where: { eventId: id }, select: { id: true } });
    const currentIds = current.map((c) => c.id);
    const incomingIds = fileTypesData.filter((f: any) => f.id && currentIds.includes(f.id)).map((f: any) => f.id);

    const toDelete = currentIds.filter((cid) => !incomingIds.includes(cid));
    const toUpdate = fileTypesData.filter((f: any) => f.id && currentIds.includes(f.id));
    const toCreate = fileTypesData.filter((f: any) => !f.id || !currentIds.includes(f.id));

    await prisma.$transaction([
      prisma.eventFileType.deleteMany({ where: { id: { in: toDelete } } }),
      ...toUpdate.map((f: any) =>
        prisma.eventFileType.update({
          where: { id: f.id },
          data: {
            name: f.name,
            description: f.description,
            allowedFileTypes: f.allowedFileTypes,
            isRequired: f.isRequired,
          },
        })
      ),
      prisma.eventFileType.createMany({
        data: toCreate.map((f: any) => ({
          eventId: id,
          name: f.name,
          description: f.description,
          allowedFileTypes: f.allowedFileTypes,
          isRequired: f.isRequired,
        })),
      }),
    ]);
  }

  const sv = ("startView" in data ? (data as any).startView : event.startView) as Date | null;
  const ev = ("endView" in data ? (data as any).endView : event.endView) as Date | null;
  if (sv && ev && sv > ev) return c.json({ message: "View period invalid: start after end" }, 400);
  const sj = ("startJoinDate" in data ? (data as any).startJoinDate : event.startJoinDate) as Date | null;
  const ej = ("endJoinDate" in data ? (data as any).endJoinDate : event.endJoinDate) as Date | null;
  if (sj && ej && sj > ej) return c.json({ message: "Submit period invalid: start after end" }, 400);
  if (sj && sv && sj >= sv) return c.json({ message: "Submission start must be before event start" }, 400);
  if (ej && sv && ej >= sv) return c.json({ message: "Submission end must be before event start" }, 400);

  const updated = await prisma.event.update({ where: { id }, data });

  // Update existing participants if rewards changed
  if (typeof data.virtualRewardGuest === "number") {
    await prisma.eventParticipant.updateMany({
      where: { eventId: id, eventGroup: "GUEST" },
      data: { virtualReward: data.virtualRewardGuest },
    });
  }
  if (typeof data.virtualRewardCommittee === "number") {
    await prisma.eventParticipant.updateMany({
      where: { eventId: id, eventGroup: "COMMITTEE" },
      data: { virtualReward: data.virtualRewardCommittee },
    });
  }

  return c.json({ message: "ok", event: updated });
});

eventsRoute.put("/:id/public-view", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const leader = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true },
  });
  if (!leader) return c.json({ message: "Forbidden" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const pv = typeof body.publicView === "boolean" ? body.publicView : undefined;
  if (typeof pv === "undefined") return c.json({ message: "publicView is required" }, 400);
  const updated = await prisma.event.update({ where: { id }, data: { publicView: pv } });
  return c.json({ message: "ok", event: updated });
});

eventsRoute.post("/:id/special-rewards", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  const contentType = c.req.header("content-type") || "";
  let data: any = {};
  let file: File | undefined;
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    if (typeof form["name"] === "string") data.name = String(form["name"]);
    if (typeof form["description"] === "string") data.description = String(form["description"]);
    const imageField = form["image"];
    const fileField = form["file"];
    if (typeof imageField === "string" && imageField === "null") {
      data.image = null;
    }
    file =
      (imageField && typeof imageField !== "string" ? (imageField as File) : undefined) ??
      (fileField as File | undefined);
    if (file) {
      const minio = getMinio();
      const bucket = process.env.OBJ_BUCKET!;
      const objectName = `special-rewards/${eventId}-${Date.now()}-${file.name}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await minio.putObject(bucket, objectName, buffer);
      data.image = `/backend/files/${bucket}/${objectName}`;
    }
  } else {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.name === "string") data.name = body.name;
    if (typeof body.description === "string") data.description = body.description;
    if ("image" in body) data.image = body.image === "null" ? null : body.image;
  }

  if (!data.name || typeof data.name !== "string" || data.name.trim().length < 1) {
    return c.json({ message: "Reward name is required" }, 400);
  }
  const created = await prisma.specialReward.create({
    data: { eventId, name: data.name, description: data.description, image: data.image },
  });
  return c.json({ message: "ok", reward: created });
});

eventsRoute.put("/:id/special-rewards/:rewardId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const rewardId = c.req.param("rewardId");
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  const reward = await prisma.specialReward.findUnique({ where: { id: rewardId } });
  if (!reward || reward.eventId !== eventId) return c.json({ message: "Reward not found" }, 404);

  const contentType = c.req.header("content-type") || "";
  let data: any = {};
  let file: File | undefined;
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    if (typeof form["name"] === "string") data.name = String(form["name"]);
    if (typeof form["description"] === "string") data.description = String(form["description"]);
    const imageField = form["image"];
    const fileField = form["file"];
    if (typeof imageField === "string" && imageField === "null") {
      data.image = null;
    }
    file =
      (imageField && typeof imageField !== "string" ? (imageField as File) : undefined) ??
      (fileField as File | undefined);
    if (file) {
      const minio = getMinio();
      const bucket = process.env.OBJ_BUCKET!;
      const objectName = `special-rewards/${eventId}-${rewardId}-${Date.now()}-${file.name}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await minio.putObject(bucket, objectName, buffer);
      data.image = `/backend/files/${bucket}/${objectName}`;
    }
  } else {
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.name === "string") data.name = body.name;
    if (typeof body.description === "string") data.description = body.description;
    if ("image" in body) data.image = body.image === "null" ? null : body.image;
  }

  const updatedReward = await prisma.specialReward.update({ where: { id: rewardId }, data });
  return c.json({ message: "ok", reward: updatedReward });
});

eventsRoute.delete("/:id/special-rewards/:rewardId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const rewardId = c.req.param("rewardId");
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  const reward = await prisma.specialReward.findUnique({ where: { id: rewardId } });
  if (!reward || reward.eventId !== eventId) return c.json({ message: "Reward not found" }, 404);

  await prisma.specialReward.delete({ where: { id: rewardId } });
  return c.json({ message: "ok", deletedId: rewardId });
});

eventsRoute.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const leader = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true },
  });
  if (!leader) return c.json({ message: "Forbidden" }, 403);
  await prisma.event.delete({ where: { id } });
  return c.json({ message: "ok", deletedId: id });
});

eventsRoute.post("/:id/publish", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const leader = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true },
  });
  if (!leader) return c.json({ message: "Forbidden" }, 403);
  const updated = await prisma.event.update({ where: { id }, data: { status: "PUBLISHED" } });
  return c.json({ message: "ok", event: updated });
});

export default eventsRoute;
