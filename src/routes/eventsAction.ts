
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.js";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const eventsActionRoute = new Hono<{ Variables: { user: User } }>();

eventsActionRoute.use("*", authMiddleware);

// Update/Give VR (PUT)
eventsActionRoute.put("/give-vr", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");
  const { projectId, amount } = await c.req.json();

  if (!eventId || !projectId || typeof amount !== "number" || amount < 0) {
    return c.json({ message: "Invalid input" }, 400);
  }

  // 1. Check if user is a participant (Guest/Committee)
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: { in: ["GUEST", "COMMITTEE"] },
    },
  });

  if (!participant) {
    return c.json({ message: "You are not a participant (Guest/Committee) in this event" }, 403);
  }

  // 2. Check if project (Team) exists in this event
  const team = await prisma.team.findFirst({
    where: {
      id: projectId,
      eventId: eventId,
    },
  });

  if (!team) {
    return c.json({ message: "Project not found in this event" }, 404);
  }

  // 3. Transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Check total usage against limit
      const otherRewards = await tx.teamReward.aggregate({
        where: {
          eventId: eventId,
          giverId: user.id,
          teamId: { not: projectId },
        },
        _sum: {
          reward: true,
        },
      });

      const totalUsedOthers = otherRewards._sum.reward || 0;
      const newTotalUsed = totalUsedOthers + amount;

      if (newTotalUsed > participant.virtualReward) {
        throw new Error("Insufficient VR balance");
      }

      // Find existing reward for this team
      const existingReward = await tx.teamReward.findFirst({
        where: {
          eventId: eventId,
          teamId: projectId,
          giverId: user.id,
        },
      });

      // Update or Create Reward
      if (existingReward) {
        if (amount === 0) {
            await tx.teamReward.delete({
                where: { id: existingReward.id }
            });
        } else {
            await tx.teamReward.update({
                where: { id: existingReward.id },
                data: { reward: amount },
            });
        }
      } else {
        if (amount > 0) {
          await tx.teamReward.create({
            data: {
              eventId: eventId,
              teamId: projectId,
              giverId: user.id,
              reward: amount,
            },
          });
        }
      }

      return { totalLimit: participant.virtualReward, totalUsed: newTotalUsed };
    });

    return c.json({
      message: "VR updated successfully",
      totalLimit: result.totalLimit,
      totalUsed: result.totalUsed,
    });
  } catch (error: any) {
    console.error("Error updating VR:", error);
    const status = error.message === "Insufficient VR balance" ? 400 : 500;
    return c.json({ message: error.message || "Internal server error" }, status);
  }
});

// Reset/Refund VR
eventsActionRoute.post("/reset-vr", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");
  const { projectId } = await c.req.json();

  if (!eventId || !projectId) {
    return c.json({ message: "Invalid input" }, 400);
  }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: { in: ["GUEST", "COMMITTEE"] },
    },
  });

  if (!participant) {
    return c.json({ message: "You are not a participant" }, 403);
  }

  // Find total rewards given by user to this project
  const rewards = await prisma.teamReward.aggregate({
    where: {
      eventId,
      teamId: projectId,
      giverId: user.id,
    },
    _sum: {
      reward: true,
    },
  });

  const totalGiven = rewards._sum.reward || 0;

  if (totalGiven === 0) {
    return c.json({ message: "No VR to refund", newBalance: participant.virtualReward });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Delete rewards for this team
      await tx.teamReward.deleteMany({
        where: {
          eventId,
          teamId: projectId,
          giverId: user.id,
        },
      });

      // Calculate remaining usage
      const remainingRewards = await tx.teamReward.aggregate({
        where: {
            eventId,
            giverId: user.id,
        },
        _sum: { reward: true }
      });
      
      const totalUsed = remainingRewards._sum.reward || 0;

      return { totalLimit: participant.virtualReward, totalUsed };
    });

    return c.json({
      message: "VR refunded successfully",
      totalLimit: result.totalLimit,
      totalUsed: result.totalUsed,
    });
  } catch (error) {
    console.error("Error refunding VR:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// Give Special Reward
eventsActionRoute.put("/give-special", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");
  const { projectId, rewardIds } = await c.req.json();

  if (!eventId || !projectId || !Array.isArray(rewardIds)) {
    return c.json({ message: "Invalid input" }, 400);
  }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: "COMMITTEE",
    },
  });

  if (!participant) {
    return c.json({ message: "You are not a committee member in this event" }, 403);
  }

  const team = await prisma.team.findFirst({
    where: { id: projectId, eventId: eventId },
  });
  if (!team) return c.json({ message: "Team not found" }, 404);

  // Validate all rewardIds exist and belong to event
  const rewards = await prisma.specialReward.findMany({
    where: {
      id: { in: rewardIds },
      eventId: eventId,
    },
  });

  if (rewards.length !== rewardIds.length) {
    return c.json({ message: "Some rewards not found or invalid" }, 400);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Get current votes by this committee for this team
      const currentVotes = await tx.specialRewardVote.findMany({
        where: {
          committeeId: participant.id,
          teamId: projectId,
        },
      });

      const currentRewardIds = currentVotes.map((v) => v.rewardId);
      
      // 2. Identify rewards to remove (in current but not in new list)
      const toRemove = currentRewardIds.filter((id) => !rewardIds.includes(id));
      
      // 3. Identify rewards to add (in new list but not in current)
      const toAdd = rewardIds.filter((id) => !currentRewardIds.includes(id));

      // 4. Check if any "toAdd" reward is already given to ANOTHER team by this committee
      // We can rely on unique constraint (rewardId, committeeId) to throw error,
      // but checking explicitly gives better error message.
      if (toAdd.length > 0) {
        const conflicts = await tx.specialRewardVote.findMany({
            where: {
                committeeId: participant.id,
                rewardId: { in: toAdd },
                teamId: { not: projectId } 
            },
            include: { reward: true }
        });

        if (conflicts.length > 0) {
            const conflictNames = conflicts.map(c => c.reward.name).join(", ");
            throw new Error(`Rewards already given to other teams: ${conflictNames}`);
        }
      }

      // 5. Remove
      if (toRemove.length > 0) {
        await tx.specialRewardVote.deleteMany({
            where: {
                committeeId: participant.id,
                teamId: projectId,
                rewardId: { in: toRemove }
            }
        });
      }

      // 6. Add
      for (const rid of toAdd) {
        await tx.specialRewardVote.create({
            data: {
                committeeId: participant.id,
                teamId: projectId,
                rewardId: rid
            }
        });
      }
    });

    return c.json({ message: "Special rewards updated successfully" });
  } catch (error: any) {
    console.error("Error giving special reward:", error);
    return c.json({ message: error.message || "Internal server error" }, 400);
  }
});

// Reset Special Reward (Remove all special rewards given to this team by this user)
eventsActionRoute.post("/reset-special", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");
  const { projectId } = await c.req.json();

  if (!eventId || !projectId) {
    return c.json({ message: "Invalid input" }, 400);
  }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: "COMMITTEE",
    },
  });

  if (!participant) {
    return c.json({ message: "You are not a committee member in this event" }, 403);
  }

  try {
    await prisma.specialRewardVote.deleteMany({
      where: {
        committeeId: participant.id,
        teamId: projectId,
      },
    });

    return c.json({ message: "Special reward reset successfully" });
  } catch (error) {
    console.error("Error resetting special reward:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

export default eventsActionRoute;
