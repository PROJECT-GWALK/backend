
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
      // Calculate total used so far (excluding current project if updating)
      const allRewards = await tx.teamReward.findMany({
        where: {
          eventId: eventId,
          giverId: user.id,
        },
      });

      const currentTotalUsed = allRewards.reduce((sum, r) => sum + r.reward, 0);
      
      // Find existing reward for this project
      const existingReward = allRewards.find(r => r.teamId === projectId);
      const oldAmount = existingReward ? existingReward.reward : 0;
      
      // Calculate projected usage
      const projectedUsed = currentTotalUsed - oldAmount + amount;

      if (projectedUsed > participant.virtualReward) {
        throw new Error("Insufficient VR balance");
      }

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

      // Return new balance (Remaining)
      return {
        virtualReward: participant.virtualReward - projectedUsed,
        totalLimit: participant.virtualReward,
        totalUsed: projectedUsed
      };
    });

    return c.json({
      message: "VR updated successfully",
      newBalance: result.virtualReward, // Remaining balance
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
      // Delete rewards
      await tx.teamReward.deleteMany({
        where: {
          eventId,
          teamId: projectId,
          giverId: user.id,
        },
      });
      
      // Calculate remaining balance
      const allRewards = await tx.teamReward.findMany({
        where: {
            eventId: eventId,
            giverId: user.id,
        },
      });
      const currentUsed = allRewards.reduce((sum, r) => sum + r.reward, 0);

      return { 
        virtualReward: participant.virtualReward - currentUsed,
        totalLimit: participant.virtualReward,
        totalUsed: currentUsed
      };
    });

    return c.json({
      message: "VR refunded successfully",
      newBalance: result.virtualReward,
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
  const { projectId, rewardIds } = await c.req.json(); // Expect rewardIds array

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

  // Validate all rewards exist
  const rewards = await prisma.specialReward.findMany({
    where: {
      id: { in: rewardIds },
      eventId: eventId,
    },
  });

  if (rewards.length !== rewardIds.length) {
    return c.json({ message: "Some rewards not found" }, 404);
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Delete all existing votes for this team by this committee
      await tx.specialRewardVote.deleteMany({
        where: {
          committeeId: participant.id,
          teamId: projectId,
        },
      });

      // 2. Create new votes
      if (rewardIds.length > 0) {
        await tx.specialRewardVote.createMany({
          data: rewardIds.map((rid: string) => ({
            rewardId: rid,
            committeeId: participant.id,
            teamId: projectId,
          })),
        });
      }
    });

    return c.json({ message: "Special rewards updated successfully" });
  } catch (error) {
    console.error("Error giving special reward:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// Give Comment
eventsActionRoute.post("/give-comment", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");
  const { projectId, content } = await c.req.json();

  if (!eventId || !projectId || typeof content !== "string") {
    return c.json({ message: "Invalid input" }, 400);
  }

  // Check if user is participant (Guest/Committee)
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

  try {
    const existingComment = await prisma.comment.findFirst({
      where: {
        eventId,
        teamId: projectId,
        userId: user.id,
      },
    });

    if (existingComment) {
      await prisma.comment.update({
        where: { id: existingComment.id },
        data: { content },
      });
    } else {
      await prisma.comment.create({
        data: {
          eventId,
          teamId: projectId,
          userId: user.id,
          content,
        },
      });
    }

    return c.json({ message: "Comment saved successfully" });
  } catch (error) {
    console.error("Error saving comment:", error);
    return c.json({ message: "Internal server error" }, 500);
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
