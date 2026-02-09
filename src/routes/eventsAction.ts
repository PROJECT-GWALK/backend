
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middlewares/auth.js";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  giveVrSchema,
  resetVrSchema,
  giveSpecialSchema,
  resetSpecialSchema,
  giveCommentSchema,
  rateEventSchema,
} from "../lib/types.js";

const eventsActionRoute = new Hono<{ Variables: { user: User } }>();

eventsActionRoute.use("*", authMiddleware);

// Update/Give VR (PUT)
eventsActionRoute.put(
  "/give-vr",
  zValidator("json", giveVrSchema),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const { projectId, amount, categories } = c.req.valid("json") as {
      projectId: string;
      amount?: number;
      categories?: { categoryId: string; amount: number }[];
    };

    if (!eventId) {
      return c.json({ message: "Invalid input" }, 400);
    }

  // 1. Check if user is a participant (Guest/Committee)
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: { in: ["GUEST", "COMMITTEE"] },
    },
    include: { event: true },
  });

  if (!participant) {
    return c.json({ message: "You are not a participant (Guest/Committee) in this event" }, 403);
  }

  // Check if event is active
  const now = new Date();
  if (!participant.event.startView || !participant.event.endView || now < participant.event.startView || now > participant.event.endView) {
      return c.json({ message: "Event is not active" }, 400);
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
      const usingCategories = Array.isArray(categories);
      const normalizedCategories = usingCategories
        ? categories.reduce(
            (acc, r) => {
              const categoryId = String(r.categoryId || "").trim();
              const rawAmount = typeof r.amount === "number" ? r.amount : 0;
              const nextAmount = Math.max(0, Math.floor(rawAmount));
              if (!categoryId) return acc;
              acc.set(categoryId, (acc.get(categoryId) || 0) + nextAmount);
              return acc;
            },
            new Map<string, number>(),
          )
        : null;
      const totalAmount = usingCategories
        ? Array.from(normalizedCategories?.values() || []).reduce((sum, n) => sum + n, 0)
        : typeof amount === "number"
          ? Math.max(0, Math.floor(amount))
          : 0;

      if (usingCategories) {
        const categoryIds = Array.from(normalizedCategories?.keys() || []);
        const existingCategories = await tx.vrCategory.findMany({
          where: { eventId: eventId, id: { in: categoryIds } },
          select: { id: true },
        });
        if (existingCategories.length !== categoryIds.length) {
          throw new Error("Some categories not found or invalid");
        }
      } else {
        if (typeof amount !== "number") {
          throw new Error("Invalid input");
        }
      }

      if (participant.event.vrTeamCapEnabled) {
        const cap =
          participant.eventGroup === "COMMITTEE"
            ? participant.event.vrTeamCapCommittee
            : participant.event.vrTeamCapGuest;
        if (typeof cap === "number" && totalAmount > cap) {
          throw new Error("Exceeds VR per-team limit");
        }
      }

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
      const otherCategoryRewards = await tx.teamRewardCategory.aggregate({
        where: {
          eventId: eventId,
          giverId: user.id,
          teamId: { not: projectId },
        },
        _sum: { amount: true },
      });

      const totalUsedOthers = (otherRewards._sum.reward || 0) + (otherCategoryRewards._sum.amount || 0);
      const thisTeamCategoryRewards = usingCategories
        ? 0
        : (
            await tx.teamRewardCategory.aggregate({
              where: { eventId: eventId, teamId: projectId, giverId: user.id },
              _sum: { amount: true },
            })
          )._sum.amount || 0;

      const newTotalUsed = totalUsedOthers + thisTeamCategoryRewards + totalAmount;

      if (newTotalUsed > participant.virtualReward) {
        throw new Error("Insufficient VR balance");
      }

      if (usingCategories) {
        await tx.teamRewardCategory.deleteMany({
          where: { eventId: eventId, teamId: projectId, giverId: user.id },
        });

        const rows = Array.from(normalizedCategories?.entries() || [])
          .filter(([, amt]) => amt > 0)
          .map(([categoryId, amt]) => ({
            eventId: eventId,
            teamId: projectId,
            giverId: user.id,
            categoryId,
            amount: amt,
          }));

        if (rows.length > 0) {
          await tx.teamRewardCategory.createMany({ data: rows });
        }

        await tx.teamReward.deleteMany({
          where: { eventId: eventId, teamId: projectId, giverId: user.id },
        });

        const usedRewards = await tx.teamReward.aggregate({
          where: { eventId: eventId, giverId: user.id },
          _sum: { reward: true },
        });
        const usedCategoryRewards = await tx.teamRewardCategory.aggregate({
          where: { eventId: eventId, giverId: user.id },
          _sum: { amount: true },
        });

        return {
          totalLimit: participant.virtualReward,
          totalUsed: (usedRewards._sum.reward || 0) + (usedCategoryRewards._sum.amount || 0),
        };
      }

      const existingReward = await tx.teamReward.findFirst({
        where: { eventId: eventId, teamId: projectId, giverId: user.id },
      });

      if (existingReward) {
        if (totalAmount === 0) {
          await tx.teamReward.delete({
            where: { id: existingReward.id },
          });
        } else {
          await tx.teamReward.update({
            where: { id: existingReward.id },
            data: { reward: totalAmount },
          });
        }
      } else if (totalAmount > 0) {
        await tx.teamReward.create({
          data: {
            eventId: eventId,
            teamId: projectId,
            giverId: user.id,
            reward: totalAmount,
          },
        });
      }

      const usedRewards = await tx.teamReward.aggregate({
        where: { eventId: eventId, giverId: user.id },
        _sum: { reward: true },
      });
      const usedCategoryRewards = await tx.teamRewardCategory.aggregate({
        where: { eventId: eventId, giverId: user.id },
        _sum: { amount: true },
      });

      return {
        totalLimit: participant.virtualReward,
        totalUsed: (usedRewards._sum.reward || 0) + (usedCategoryRewards._sum.amount || 0),
      };
    });

    return c.json({
      message: "VR updated successfully",
      totalLimit: result.totalLimit,
      totalUsed: result.totalUsed,
    });
  } catch (error: any) {
    console.error("Error updating VR:", error);
    const status = [
      "Insufficient VR balance",
      "Exceeds VR per-team limit",
      "Some categories not found or invalid",
      "Invalid input",
    ].includes(error.message)
      ? 400
      : 500;
    return c.json({ message: error.message || "Internal server error" }, status);
  }
});

// Reset/Refund VR
eventsActionRoute.post(
  "/reset-vr",
  zValidator("json", resetVrSchema),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const { projectId } = c.req.valid("json");

    if (!eventId) {
      return c.json({ message: "Invalid input" }, 400);
    }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: { in: ["GUEST", "COMMITTEE"] },
    },
    include: { event: true },
  });

  if (!participant) {
    return c.json({ message: "You are not a participant" }, 403);
  }

  // Check if event is active
  const now = new Date();
  if (!participant.event.startView || !participant.event.endView || now < participant.event.startView || now > participant.event.endView) {
      return c.json({ message: "Event is not active" }, 400);
  }

  const rewards = await prisma.teamReward.aggregate({
    where: { eventId, teamId: projectId, giverId: user.id },
    _sum: { reward: true },
  });
  const categoryRewards = await prisma.teamRewardCategory.aggregate({
    where: { eventId, teamId: projectId, giverId: user.id },
    _sum: { amount: true },
  });

  const totalGiven = (rewards._sum.reward || 0) + (categoryRewards._sum.amount || 0);

  if (totalGiven === 0) {
    return c.json({ message: "No VR to refund", newBalance: participant.virtualReward });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.teamRewardCategory.deleteMany({
        where: {
          eventId,
          teamId: projectId,
          giverId: user.id,
        },
      });

      // Delete rewards for this team
      await tx.teamReward.deleteMany({
        where: {
          eventId,
          teamId: projectId,
          giverId: user.id,
        },
      });

      const remainingRewards = await tx.teamReward.aggregate({
        where: { eventId, giverId: user.id },
        _sum: { reward: true },
      });
      const remainingCategoryRewards = await tx.teamRewardCategory.aggregate({
        where: { eventId, giverId: user.id },
        _sum: { amount: true },
      });

      const totalUsed =
        (remainingRewards._sum.reward || 0) + (remainingCategoryRewards._sum.amount || 0);

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
eventsActionRoute.put(
  "/give-special",
  zValidator("json", giveSpecialSchema),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const { projectId, rewardIds } = c.req.valid("json");

    if (!eventId) {
      return c.json({ message: "Invalid input" }, 400);
    }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: "COMMITTEE",
    },
    include: { event: true },
  });

  if (!participant) {
    return c.json({ message: "You are not a committee member in this event" }, 403);
  }

  // Check if event is active
  const now = new Date();
  if (!participant.event.startView || !participant.event.endView || now < participant.event.startView || now > participant.event.endView) {
      return c.json({ message: "Event is not active" }, 400);
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
eventsActionRoute.post(
  "/reset-special",
  zValidator("json", resetSpecialSchema),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const { projectId } = c.req.valid("json");

    if (!eventId) {
      return c.json({ message: "Invalid input" }, 400);
    }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: "COMMITTEE",
    },
    include: { event: true },
  });

  if (!participant) {
    return c.json({ message: "You are not a committee member in this event" }, 403);
  }

  // Check if event is active
  const now = new Date();
  if (!participant.event.startView || !participant.event.endView || now < participant.event.startView || now > participant.event.endView) {
      return c.json({ message: "Event is not active" }, 400);
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

// Give Comment
eventsActionRoute.post(
  "/give-comment",
  zValidator("json", giveCommentSchema),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const { projectId, content } = c.req.valid("json");

    if (!eventId) {
      return c.json({ message: "Invalid input" }, 400);
    }

  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
      eventGroup: { in: ["GUEST", "COMMITTEE"] },
    },
    include: { event: true },
  });

  if (!participant) {
    return c.json({ message: "You are not a participant (Guest/Committee) in this event" }, 403);
  }

  // Check if event is active
  const now = new Date();
  if (!participant.event.startView || !participant.event.endView || now < participant.event.startView || now > participant.event.endView) {
      return c.json({ message: "Event is not active" }, 400);
  }

  const team = await prisma.team.findFirst({
    where: { id: projectId, eventId: eventId },
  });
  if (!team) return c.json({ message: "Team not found" }, 404);

  try {
    // Check if comment already exists for this user and team
    const existing = await prisma.comment.findFirst({
      where: {
        eventId,
        teamId: projectId,
        userId: user.id,
      },
    });

    if (existing) {
      await prisma.comment.update({
        where: { id: existing.id },
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

    return c.json({ message: "Comment posted successfully" });
  } catch (error) {
    console.error("Error posting comment:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// Rate Event (PUT)
eventsActionRoute.put(
  "/rate",
  zValidator("json", rateEventSchema),
  async (c) => {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const { rating, comment } = c.req.valid("json");

    if (!eventId) {
      return c.json({ message: "Invalid input" }, 400);
    }

  // Check participation
  const participant = await prisma.eventParticipant.findFirst({
    where: {
      eventId: eventId,
      userId: user.id,
    },
    include: { event: true },
  });

  if (!participant) {
    return c.json({ message: "You are not a participant in this event" }, 403);
  }

  // Check if event is active
  const now = new Date();
  if (!participant.event.startView || !participant.event.endView || now < participant.event.startView || now > participant.event.endView) {
      return c.json({ message: "Event is not active" }, 400);
  }

  if (participant.eventGroup === "ORGANIZER") {
    return c.json({ message: "Organizers cannot rate their own events" }, 403);
  }

  try {
    const existing = await prisma.eventRating.findUnique({
      where: {
        eventId_userId: {
          userId: user.id,
          eventId: eventId,
        },
      },
    });

    if (existing) {
      await prisma.eventRating.update({
        where: { id: existing.id },
        data: { rating, comment },
      });
    } else {
      await prisma.eventRating.create({
        data: {
          eventId,
          userId: user.id,
          rating,
          comment,
        },
      });
    }

    return c.json({ message: "Rating submitted successfully" });
  } catch (error) {
    console.error("Error submitting rating:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// Get User Rating (GET)
eventsActionRoute.get("/rate", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");

  if (!eventId) {
    return c.json({ message: "Event ID is required" }, 400);
  }

  try {
    const rating = await prisma.eventRating.findUnique({
      where: {
        eventId_userId: {
          userId: user.id,
          eventId: eventId as string,
        },
      },
    });

    return c.json({ rating: rating ? rating.rating : null, comment: rating ? rating.comment : null });
  } catch (error) {
    console.error("Error fetching rating:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// Get All Ratings (GET) - For Organizer
eventsActionRoute.get("/ratings", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");

  if (!eventId) {
    return c.json({ message: "Event ID is required" }, 400);
  }

  try {
    // Check if user is organizer
    const participant = await prisma.eventParticipant.findFirst({
      where: {
        eventId: eventId,
        userId: user.id,
        eventGroup: "ORGANIZER",
      },
    });

    if (!participant) {
      return c.json({ message: "Only organizers can view all ratings" }, 403);
    }

    const ratings = await prisma.eventRating.findMany({
      where: { eventId: eventId },
      include: {
        user: {
          select: {
            name: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return c.json({ ratings });
  } catch (error) {
    console.error("Error fetching ratings:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

export default eventsActionRoute;
