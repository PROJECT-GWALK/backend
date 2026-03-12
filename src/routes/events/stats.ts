import { Hono } from "hono";
import { prisma } from "../../lib/prisma.js";
import type { User } from "../../generated/prisma/client.js";
import { withCompetitionRank, sortTeamScores, buildTeamScores } from "./helpers.js";

const statsRoute = new Hono<{ Variables: { user: User | null } }>();

statsRoute.get("/:id/presenter/stats", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  // 1. Find user's team in this event
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId,
      userId: user.id,
      eventGroup: "PRESENTER",
      deletedAt: null,
    },
    include: { team: { where: { deletedAt: null } } },
  });

  if (!participant || !participant.teamId) {
    return c.json({ message: "You are not a presenter in a team for this event" }, 404);
  }

  const teamId = participant.teamId;

  // 2. Calculate Rank & Score
  const allTeams = await prisma.team.findMany({
    where: { eventId, deletedAt: null },
    include: {
      rewards: { where: { deletedAt: null } },
      categoryRewards: { where: { deletedAt: null } },
    },
  });

  const rankedTeams = withCompetitionRank(sortTeamScores(buildTeamScores(allTeams)));
  const myTeam = rankedTeams.find((team) => team.id === teamId);
  const myRank = myTeam?.rank ?? "-";
  const myScore = myTeam?.totalReward ?? 0;

  // 3. Comments Breakdown
  const comments = await prisma.comment.findMany({
    where: { teamId, eventId, deletedAt: null },
    include: {
      user: {
        include: {
          participants: {
            where: { eventId, deletedAt: null },
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
    where: { eventId, deletedAt: null },
  });

  const specialVotes = await prisma.specialRewardVote.findMany({
    where: { teamId, deletedAt: null },
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

statsRoute.get("/:id/rankings", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null },
    include: {
      specialRewards: {
        where: { deletedAt: null },
        include: {
          votes: { where: { deletedAt: null } },
        },
      },
    },
  });

  if (!event) return c.json({ message: "Event not found" }, 404);
  if (event.status !== "PUBLISHED") return c.json({ message: "Event not published" }, 403);
  if (event.isHidden) return c.json({ message: "Forbidden" }, 403);

  // Check permission
  let canView = event.publicView;
  if (!canView && user) {
    const p = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user.id, deletedAt: null },
    });
    if (p) canView = true;
  }
  if (!canView) return c.json({ message: "Forbidden" }, 403);

  // Fetch Teams & Calculate VR Scores
  const teams = await prisma.team.findMany({
    where: { eventId, deletedAt: null },
    include: {
      rewards: { where: { deletedAt: null } },
      categoryRewards: { where: { deletedAt: null } },
    },
  });

  const rankings = withCompetitionRank(sortTeamScores(buildTeamScores(teams))).map((team) => ({
    id: team.id,
    name: team.name,
    totalReward: team.totalReward,
    imageCover: team.imageCover,
    rank: team.rank,
  }));

  // Special Rewards Winners
  const specialRewards = event.specialRewards.map((reward) => {
    const voteCounts: Record<string, number> = {};
    reward.votes.forEach((v) => {
      voteCounts[v.teamId] = (voteCounts[v.teamId] || 0) + 1;
    });

    const votedTeams = Object.entries(voteCounts)
      .map(([teamId, votes]) => {
        const team = teams.find((t) => t.id === teamId);
        if (!team) return null;
        return { id: team.id, name: team.teamName, votes };
      })
      .filter((x): x is { id: string; name: string; votes: number } => Boolean(x))
      .sort((a, b) => (b.votes !== a.votes ? b.votes - a.votes : a.name.localeCompare(b.name)));

    const maxVotes = votedTeams.length > 0 ? votedTeams[0].votes : 0;
    const winners = maxVotes > 0 ? votedTeams.filter((t) => t.votes === maxVotes) : [];
    const winner = winners.length > 0 ? winners[0] : null;

    return {
      id: reward.id,
      name: reward.name,
      description: reward.description,
      image: reward.image,
      winner,
      winners,
      votes: votedTeams,
    };
  });

  return c.json({
    message: "ok",
    rankings,
    specialRewards,
  });
});

export default statsRoute;
