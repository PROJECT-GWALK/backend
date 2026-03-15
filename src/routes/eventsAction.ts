import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middlewares/auth.js";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { createLog } from "../lib/logger.js";
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
    const { projectId, amount } = c.req.valid("json") as {
      projectId: string;
      amount: number;
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
        deletedAt: null,
      },
      include: { event: true },
    });

    if (!participant) {
      return c.json(
        {
          message: "You are not a participant (Guest/Committee) in this event",
        },
        403,
      );
    }
    if (participant.event.isHidden) {
      return c.json({ message: "Event is hidden by admin" }, 403);
    }

    // Check if event is active
    const now = new Date();
    if (
      !participant.event.startView ||
      !participant.event.endView ||
      now < participant.event.startView ||
      now > participant.event.endView
    ) {
      return c.json({ message: "Event is not active" }, 400);
    }

    // 2. Check if project (Team) exists in this event
    const team = await prisma.team.findFirst({
      where: {
        id: projectId,
        eventId: eventId,
        deletedAt: null,
      },
    });

    if (!team) {
      return c.json({ message: "Project not found in this event" }, 404);
    }

    // 3. Transaction
    try {
      const result = await prisma.$transaction(async (tx) => {
        const totalAmount =
          typeof amount === "number" ? Math.max(0, Math.floor(amount)) : 0;

        if (typeof amount !== "number") {
          throw new Error("Invalid input");
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
            deletedAt: null,
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
            deletedAt: null,
          },
          _sum: { amount: true },
        });

        const totalUsedOthers =
          (otherRewards._sum.reward || 0) +
          (otherCategoryRewards._sum.amount || 0);
        const thisTeamCategoryRewards =
          (
            await tx.teamRewardCategory.aggregate({
              where: { eventId: eventId, teamId: projectId, giverId: user.id, deletedAt: null },
              _sum: { amount: true },
            })
          )._sum.amount || 0;

        const newTotalUsed =
          totalUsedOthers + thisTeamCategoryRewards + totalAmount;

        if (newTotalUsed > participant.virtualReward) {
          throw new Error("Insufficient VR balance");
        }

        await tx.teamRewardCategory.updateMany({
          where: { eventId: eventId, teamId: projectId, giverId: user.id },
          data: { deletedAt: new Date() },
        });

        const existingReward = await tx.teamReward.findFirst({
          where: { eventId: eventId, teamId: projectId, giverId: user.id, deletedAt: null },
        });

        if (existingReward) {
          if (totalAmount === 0) {
            await tx.teamReward.update({
              where: { id: existingReward.id },
              data: { deletedAt: new Date() },
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
          where: { eventId: eventId, giverId: user.id, deletedAt: null },
          _sum: { reward: true },
        });
        const usedCategoryRewards = await tx.teamRewardCategory.aggregate({
          where: { eventId: eventId, giverId: user.id, deletedAt: null },
          _sum: { amount: true },
        });

        return {
          totalLimit: participant.virtualReward,
          totalUsed:
            (usedRewards._sum.reward || 0) +
            (usedCategoryRewards._sum.amount || 0),
        };
      });

      // Disable logging for GIVE_VR to reduce noise
      // await createLog(
      //   user.id,
      //   "GIVE_VR",
      //   `Gave ${amount} VR to team ${projectId}`,
      //   c.req.header("x-forwarded-for"),
      //   c.req.header("user-agent")
      // );

      return c.json({
        message: "VR updated successfully",
        totalLimit: result.totalLimit,
        totalUsed: result.totalUsed,
      });
    } catch (error: any) {
      await createLog(
        user.id,
        "ERROR_GIVE_VR",
        `Error updating VR: ${error.message}`,
        c.req.header("x-forwarded-for"),
        c.req.header("user-agent")
      );
      const status = [
        "Insufficient VR balance",
        "Exceeds VR per-team limit",
        "Invalid input",
      ].includes(error.message)
        ? 400
        : 500;
      return c.json(
        { message: error.message || "Internal server error" },
        status,
      );
    }
  },
);

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
        deletedAt: null,
      },
      include: { event: true },
    });

    if (!participant) {
      return c.json({ message: "You are not a participant" }, 403);
    }
    if (participant.event.isHidden) {
      return c.json({ message: "Event is hidden by admin" }, 403);
    }

    // Check if event is active
    const now = new Date();
    if (
      !participant.event.startView ||
      !participant.event.endView ||
      now < participant.event.startView ||
      now > participant.event.endView
    ) {
      return c.json({ message: "Event is not active" }, 400);
    }

    const rewards = await prisma.teamReward.aggregate({
      where: { eventId, teamId: projectId, giverId: user.id, deletedAt: null },
      _sum: { reward: true },
    });
    const categoryRewards = await prisma.teamRewardCategory.aggregate({
      where: { eventId, teamId: projectId, giverId: user.id, deletedAt: null },
      _sum: { amount: true },
    });

    const totalGiven =
      (rewards._sum.reward || 0) + (categoryRewards._sum.amount || 0);

    if (totalGiven === 0) {
      return c.json({
        message: "No VR to refund",
        newBalance: participant.virtualReward,
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.teamRewardCategory.updateMany({
          where: {
            eventId,
            teamId: projectId,
            giverId: user.id,
          },
          data: { deletedAt: new Date() },
        });

        // Delete rewards for this team
        await tx.teamReward.updateMany({
          where: {
            eventId,
            teamId: projectId,
            giverId: user.id,
          },
          data: { deletedAt: new Date() },
        });

        const remainingRewards = await tx.teamReward.aggregate({
          where: { eventId, giverId: user.id, deletedAt: null },
          _sum: { reward: true },
        });
        const remainingCategoryRewards = await tx.teamRewardCategory.aggregate({
          where: { eventId, giverId: user.id, deletedAt: null },
          _sum: { amount: true },
        });

        const totalUsed =
          (remainingRewards._sum.reward || 0) +
          (remainingCategoryRewards._sum.amount || 0);

        return { totalLimit: participant.virtualReward, totalUsed };
      });

      // await createLog(
      //   user.id,
      //   "RESET_VR",
      //   `Reset VR for team ${projectId}`,
      //   c.req.header("x-forwarded-for"),
      //   c.req.header("user-agent")
      // );

      return c.json({
        message: "VR refunded successfully",
        totalLimit: result.totalLimit,
        totalUsed: result.totalUsed,
      });
    } catch (error) {
      console.error("Error refunding VR:", error);
      return c.json({ message: "Internal server error" }, 500);
    }
  },
);

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
        eventGroup: { in: ["COMMITTEE", "GUEST"] },
        deletedAt: null,
      },
      include: { event: true },
    });

    if (!participant) {
      return c.json(
        { message: "You are not a participant (Committee/Guest) in this event" },
        403,
      );
    }
    if (participant.event.isHidden) {
      return c.json({ message: "Event is hidden by admin" }, 403);
    }

    // Check if event is active
    const now = new Date();
    if (
      !participant.event.startView ||
      !participant.event.endView ||
      now < participant.event.startView ||
      now > participant.event.endView
    ) {
      return c.json({ message: "Event is not active" }, 400);
    }

    const team = await prisma.team.findFirst({
      where: { id: projectId, eventId: eventId, deletedAt: null },
    });
    if (!team) return c.json({ message: "Team not found" }, 404);

    // Validate all rewardIds exist and belong to event
    const rewards = await prisma.specialReward.findMany({
      where: {
        id: { in: rewardIds },
        eventId: eventId,
        deletedAt: null,
      },
    });

    if (rewards.length !== rewardIds.length) {
      return c.json({ message: "Some rewards not found or invalid" }, 400);
    }
    if (
      participant.eventGroup === "GUEST" &&
      rewards.some((r) => !r.allowGuestVote)
    ) {
      return c.json({ message: "Some rewards are not available for guests" }, 400);
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Get current votes by this committee for this team
        const currentVotes = await tx.specialRewardVote.findMany({
          where: {
            committeeId: participant.id,
            teamId: projectId,
            deletedAt: null,
          },
        });

        const currentRewardIds = currentVotes.map((v) => v.rewardId);

        // 2. Identify rewards to remove (in current but not in new list)
        const toRemove = currentRewardIds.filter(
          (id) => !rewardIds.includes(id),
        );

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
              teamId: { not: projectId },
              deletedAt: null,
            },
            include: { reward: true },
          });

          if (conflicts.length > 0) {
            const conflictNames = conflicts
              .map((c) => c.reward.name)
              .join(", ");
            throw new Error(
              `Rewards already given to other teams: ${conflictNames}`,
            );
          }
        }

        // 5. Remove
        if (toRemove.length > 0) {
          await tx.specialRewardVote.updateMany({
            where: {
              committeeId: participant.id,
              teamId: projectId,
              rewardId: { in: toRemove },
            },
            data: { deletedAt: new Date() },
          });
        }

        // 6. Add
        for (const rid of toAdd) {
          // Check if it was previously soft deleted
          const existing = await tx.specialRewardVote.findFirst({
            where: {
              committeeId: participant.id,
              teamId: projectId,
              rewardId: rid,
            },
          });

          if (existing) {
             await tx.specialRewardVote.update({
               where: { id: existing.id },
               data: { deletedAt: null },
             });
          } else {
             await tx.specialRewardVote.create({
               data: {
                 committeeId: participant.id,
                 teamId: projectId,
                 rewardId: rid,
               },
             });
          }
        }
      });

      // await createLog(
      //   user.id,
      //   "GIVE_SPECIAL_REWARD",
      //   `Gave special rewards to team ${projectId}`,
      //   c.req.header("x-forwarded-for"),
      //   c.req.header("user-agent")
      // );

      return c.json({ message: "Special rewards updated successfully" });
    } catch (error: any) {
      console.error("Error giving special reward:", error);
      return c.json({ message: error.message || "Internal server error" }, 400);
    }
  },
);

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
        eventGroup: { in: ["COMMITTEE", "GUEST"] },
        deletedAt: null,
      },
      include: { event: true },
    });

    if (!participant) {
      return c.json(
        { message: "You are not a participant (Committee/Guest) in this event" },
        403,
      );
    }
    if (participant.event.isHidden) {
      return c.json({ message: "Event is hidden by admin" }, 403);
    }

    // Check if event is active
    const now = new Date();
    if (
      !participant.event.startView ||
      !participant.event.endView ||
      now < participant.event.startView ||
      now > participant.event.endView
    ) {
      return c.json({ message: "Event is not active" }, 400);
    }

    try {
      await prisma.specialRewardVote.updateMany({
        where: {
          committeeId: participant.id,
          teamId: projectId,
        },
        data: { deletedAt: new Date() },
      });

      // await createLog(
      //   user.id,
      //   "RESET_SPECIAL_REWARD",
      //   `Reset special rewards for team ${projectId}`,
      //   c.req.header("x-forwarded-for"),
      //   c.req.header("user-agent")
      // );

      return c.json({ message: "Special reward reset successfully" });
    } catch (error) {
      console.error("Error resetting special reward:", error);
      return c.json({ message: "Internal server error" }, 500);
    }
  },
);

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
        deletedAt: null,
      },
      include: { event: true },
    });

    if (!participant) {
      return c.json(
        {
          message: "You are not a participant (Guest/Committee) in this event",
        },
        403,
      );
    }
    if (participant.event.isHidden) {
      return c.json({ message: "Event is hidden by admin" }, 403);
    }

    // Check if event is active
    const now = new Date();
    if (
      !participant.event.startView ||
      !participant.event.endView ||
      now < participant.event.startView ||
      now > participant.event.endView
    ) {
      return c.json({ message: "Event is not active" }, 400);
    }

    const team = await prisma.team.findFirst({
      where: { id: projectId, eventId: eventId, deletedAt: null },
    });
    if (!team) return c.json({ message: "Team not found" }, 404);

    try {
      // Check if comment already exists for this user and team
      const existing = await prisma.comment.findFirst({
        where: {
          eventId,
          teamId: projectId,
          userId: user.id,
          // deletedAt: null, // Comment logic: update if exists (even if deleted? No, if deleted, maybe create new or revive). 
          // Let's assume we want to update the visible one.
          deletedAt: null,
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

      // await createLog(
      //   user.id,
      //   "GIVE_COMMENT",
      //   `Commented on team ${projectId}`,
      //   c.req.header("x-forwarded-for"),
      //   c.req.header("user-agent")
      // );

      return c.json({ message: "Comment posted successfully" });
    } catch (error) {
      console.error("Error posting comment:", error);
      return c.json({ message: "Internal server error" }, 500);
    }
  },
);

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
        deletedAt: null,
      },
      include: { event: true },
    });

    if (!participant) {
      return c.json(
        { message: "You are not a participant in this event" },
        403,
      );
    }
    if (participant.event.isHidden) {
      return c.json({ message: "Event is hidden by admin" }, 403);
    }

    const now = new Date();
    if (!participant.event.endView) {
      return c.json({ message: "Event end time is not set" }, 400);
    }
    if (now < participant.event.endView) {
      return c.json({ message: "Event is not finished" }, 400);
    }

    try {
      const existing = await prisma.eventRating.findFirst({
        where: {
          eventId,
          userId: user.id,
          deletedAt: null,
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

      // await createLog(
      //   user.id,
      //   "RATE_EVENT",
      //   `Rated event ${eventId} with ${rating} stars`,
      //   c.req.header("x-forwarded-for"),
      //   c.req.header("user-agent")
      // );

      return c.json({ message: "Rating submitted successfully" });
    } catch (error) {
      console.error("Error submitting rating:", error);
      return c.json({ message: "Internal server error" }, 500);
    }
  },
);

// Get User Rating (GET)
eventsActionRoute.get("/rate", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");

  if (!eventId) {
    return c.json({ message: "Event ID is required" }, 400);
  }

  try {
    const rating = await prisma.eventRating.findFirst({
      where: {
        eventId: eventId as string,
        userId: user.id,
        deletedAt: null,
      },
    });

    return c.json({
      rating: rating ? rating.rating : null,
      comment: rating ? rating.comment : null,
    });
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
        deletedAt: null,
      },
    });

    if (!participant) {
      return c.json({ message: "Only organizers can view all ratings" }, 403);
    }

    const ratings = await prisma.eventRating.findMany({
      where: { eventId: eventId, deletedAt: null },
      include: {
        user: {
          select: {
            name: true,
            image: true,
            username: true,
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
