
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
      // Find existing reward
      const existingReward = await tx.teamReward.findFirst({
        where: {
          eventId: eventId,
          teamId: projectId,
          giverId: user.id,
        },
      });

      const oldAmount = existingReward ? existingReward.reward : 0;
      const difference = amount - oldAmount;

      if (difference > 0) {
        // Giving more
        if (participant.virtualReward < difference) {
          throw new Error("Insufficient VR balance");
        }
      }

      // Update Participant Balance
      const updatedParticipant = await tx.eventParticipant.update({
        where: { id: participant.id },
        data: {
          virtualReward: { decrement: difference }, // Handle both give (positive diff) and refund (negative diff)
        },
      });

      // Update or Create Reward
      if (existingReward) {
        if (amount === 0) {
            // Option: delete if 0 to keep table clean, or just set 0
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

      return updatedParticipant;
    });

    return c.json({
      message: "VR updated successfully",
      newBalance: result.virtualReward,
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
      // Refund user
      const updatedParticipant = await tx.eventParticipant.update({
        where: { id: participant.id },
        data: {
          virtualReward: { increment: totalGiven },
        },
      });

      // Delete rewards
      await tx.teamReward.deleteMany({
        where: {
          eventId,
          teamId: projectId,
          giverId: user.id,
        },
      });

      return updatedParticipant;
    });

    return c.json({
      message: "VR refunded successfully",
      newBalance: result.virtualReward,
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
  const { projectId, rewardId } = await c.req.json();

  if (!eventId || !projectId || !rewardId) {
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

  const reward = await prisma.specialReward.findFirst({
    where: { id: rewardId, eventId: eventId },
  });
  if (!reward) return c.json({ message: "Reward not found" }, 404);

  try {
    await prisma.specialRewardVote.upsert({
      where: {
        rewardId_committeeId: {
          rewardId: rewardId,
          committeeId: participant.id,
        },
      },
      update: {
        teamId: projectId,
      },
      create: {
        rewardId: rewardId,
        committeeId: participant.id,
        teamId: projectId,
      },
    });
    return c.json({ message: "Special reward given successfully" });
  } catch (error) {
    console.error("Error giving special reward:", error);
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
