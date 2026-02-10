import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middlewares/auth.js";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";

// Validation Schemas
const createEvaluationCriteriaSchema = z.object({
  name: z.string().min(1, "Criteria name is required"),
  description: z.string().optional(),
  maxScore: z.number().positive("Max score must be positive"),
  weightPercentage: z.number().min(0).max(100, "Weight must be between 0-100"),
  sortOrder: z.number().int().default(0),
});

const updateEvaluationCriteriaSchema = createEvaluationCriteriaSchema.partial();

const submitGradeSchema = z.object({
  teamId: z.string().uuid("Invalid team ID"),
  criteriaId: z.string().uuid("Invalid criteria ID"),
  score: z
    .number()
    .min(0, "Score cannot be negative")
    .refine((val) => Number.isFinite(val), "Score must be a valid number"),
});

type CreateEvaluationCriteriaInput = z.infer<typeof createEvaluationCriteriaSchema>;
type UpdateEvaluationCriteriaInput = z.infer<typeof updateEvaluationCriteriaSchema>;
type SubmitGradeInput = z.infer<typeof submitGradeSchema>;

const evaluationRoute = new Hono<{ Variables: { user: User } }>();

evaluationRoute.use("*", authMiddleware);

/**
 * GET /evaluation/event/:eventId/criteria
 * Get all evaluation criteria for an event
 * Accessible by: ORGANIZER, COMMITTEE
 */
evaluationRoute.get("/event/:eventId/criteria", async (c) => {
  try {
    const user = c.get("user");
    const eventId = c.req.param("eventId");

    if (!eventId) {
      return c.json({ message: "Event ID is required" }, 400);
    }

    // Check if user is organizer or committee member for this event
    const participant = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        userId: user.id,
        eventGroup: { in: ["ORGANIZER", "COMMITTEE"] },
      },
    });

    if (!participant) {
      return c.json({ message: "Access denied" }, 403);
    }

    const criteria = await prisma.evaluationCriteria.findMany({
      where: { eventId },
      orderBy: { sortOrder: "asc" },
    });

    return c.json({ criteria });
  } catch (error) {
    console.error("Error fetching criteria:", error);
    return c.json({ message: "Failed to fetch criteria" }, 500);
  }
});

/**
 * POST /evaluation/event/:eventId/criteria
 * Create evaluation criteria for an event
 * Accessible by: ORGANIZER only
 */
evaluationRoute.post(
  "/event/:eventId/criteria",
  zValidator("json", createEvaluationCriteriaSchema),
  async (c) => {
    try {
      const user = c.get("user");
      const eventId = c.req.param("eventId");
      const input = c.req.valid("json") as CreateEvaluationCriteriaInput;

      if (!eventId) {
        return c.json({ message: "Event ID is required" }, 400);
      }

      // Check if user is organizer
      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) {
        return c.json({ message: "Event not found" }, 404);
      }

      const organizer = await prisma.eventParticipant.findFirst({
        where: {
          eventId,
          userId: user.id,
          eventGroup: "ORGANIZER",
        },
      });

      if (!organizer) {
        return c.json({ message: "Only organizers can create criteria" }, 403);
      }

      const criteria = await prisma.evaluationCriteria.create({
        data: {
          eventId,
          name: input.name,
          description: input.description,
          maxScore: input.maxScore,
          weightPercentage: input.weightPercentage,
          sortOrder: input.sortOrder,
        },
      });

      return c.json({ criteria }, 201);
    } catch (error) {
      console.error("Error creating criteria:", error);
      return c.json({ message: "Failed to create criteria" }, 500);
    }
  },
);

/**
 * PUT /evaluation/event/:eventId/criteria/:criteriaId
 * Update evaluation criteria
 * Accessible by: ORGANIZER only
 */
evaluationRoute.put(
  "/event/:eventId/criteria/:criteriaId",
  zValidator("json", updateEvaluationCriteriaSchema),
  async (c) => {
    try {
      const user = c.get("user");
      const eventId = c.req.param("eventId");
      const criteriaId = c.req.param("criteriaId");
      const input = c.req.valid("json") as UpdateEvaluationCriteriaInput;

      if (!eventId || !criteriaId) {
        return c.json({ message: "Event ID and Criteria ID are required" }, 400);
      }

      // Check if user is organizer
      const organizer = await prisma.eventParticipant.findFirst({
        where: {
          eventId,
          userId: user.id,
          eventGroup: "ORGANIZER",
        },
      });

      if (!organizer) {
        return c.json({ message: "Only organizers can update criteria" }, 403);
      }

      const criteria = await prisma.evaluationCriteria.update({
        where: { id: criteriaId },
        data: input,
      });

      return c.json({ criteria });
    } catch (error: any) {
      if (error.code === "P2025") {
        return c.json({ message: "Criteria not found" }, 404);
      }
      console.error("Error updating criteria:", error);
      return c.json({ message: "Failed to update criteria" }, 500);
    }
  },
);

/**
 * DELETE /evaluation/event/:eventId/criteria/:criteriaId
 * Delete evaluation criteria
 * Accessible by: ORGANIZER only
 */
evaluationRoute.delete("/event/:eventId/criteria/:criteriaId", async (c) => {
  try {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const criteriaId = c.req.param("criteriaId");

    if (!eventId || !criteriaId) {
      return c.json({ message: "Event ID and Criteria ID are required" }, 400);
    }

    // Check if user is organizer
    const organizer = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        userId: user.id,
        eventGroup: "ORGANIZER",
      },
    });

    if (!organizer) {
      return c.json({ message: "Only organizers can delete criteria" }, 403);
    }

    await prisma.evaluationCriteria.delete({
      where: { id: criteriaId },
    });

    return c.json({ message: "Criteria deleted successfully" });
  } catch (error: any) {
    if (error.code === "P2025") {
      return c.json({ message: "Criteria not found" }, 404);
    }
    console.error("Error deleting criteria:", error);
    return c.json({ message: "Failed to delete criteria" }, 500);
  }
});

/**
 * POST /evaluation/event/:eventId/team/:teamId/grade
 * Submit grade for a project
 * Accessible by: COMMITTEE only
 */
evaluationRoute.post(
  "/event/:eventId/team/:teamId/grade",
  zValidator("json", submitGradeSchema),
  async (c) => {
    try {
      const user = c.get("user");
      const eventId = c.req.param("eventId");
      const teamId = c.req.param("teamId");
      const { criteriaId, score } = c.req.valid("json") as SubmitGradeInput;

      if (!eventId || !teamId || !criteriaId) {
        return c.json(
          {
            message: "Event ID, Team ID, and Criteria ID are required",
          },
          400,
        );
      }

      // Check if user is a committee member
      const participant = await prisma.eventParticipant.findFirst({
        where: {
          eventId,
          userId: user.id,
          eventGroup: "COMMITTEE",
        },
      });

      if (!participant) {
        return c.json(
          {
            message: "Only committee members can submit grades",
          },
          403,
        );
      }

      // Verify team exists in event
      const team = await prisma.team.findFirst({
        where: { id: teamId, eventId },
      });

      if (!team) {
        return c.json({ message: "Team not found in this event" }, 404);
      }

      // Verify criteria exists and get maxScore
      const criteria = await prisma.evaluationCriteria.findFirst({
        where: { id: criteriaId, eventId },
      });

      if (!criteria) {
        return c.json({ message: "Criteria not found in this event" }, 404);
      }

      // Validate score does not exceed maxScore
      if (score > criteria.maxScore) {
        return c.json(
          {
            message: `Score cannot exceed max score of ${criteria.maxScore}`,
          },
          400,
        );
      }

      // Upsert the evaluation result
      const result = await prisma.evaluationResult.upsert({
        where: {
          teamId_criteriaId_committeeId: {
            teamId,
            criteriaId,
            committeeId: user.id,
          },
        },
        update: { score },
        create: {
          eventId,
          teamId,
          criteriaId,
          committeeId: user.id,
          score,
        },
      });

      return c.json({ result }, 200);
    } catch (error) {
      console.error("Error submitting grade:", error);
      return c.json({ message: "Failed to submit grade" }, 500);
    }
  },
);

/**
 * GET /evaluation/event/:eventId/team/:teamId/grades
 * Get all grades for a project from the current user (committee)
 * Accessible by: COMMITTEE
 */
evaluationRoute.get("/event/:eventId/team/:teamId/grades", async (c) => {
  try {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const teamId = c.req.param("teamId");

    if (!eventId || !teamId) {
      return c.json({ message: "Event ID and Team ID are required" }, 400);
    }

    // Check if user is a committee member
    const participant = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        userId: user.id,
        eventGroup: "COMMITTEE",
      },
    });

    if (!participant) {
      return c.json({ message: "Access denied" }, 403);
    }

    const grades = await prisma.evaluationResult.findMany({
      where: {
        eventId,
        teamId,
        committeeId: user.id,
      },
      include: {
        criteria: true,
      },
    });

    return c.json({ grades });
  } catch (error) {
    console.error("Error fetching grades:", error);
    return c.json({ message: "Failed to fetch grades" }, 500);
  }
});

/**
 * GET /evaluation/event/:eventId/results
 * Get all grading results for an event with averages
 * Accessible by: ORGANIZER only
 */
evaluationRoute.get("/event/:eventId/results", async (c) => {
  try {
    const user = c.get("user");
    const eventId = c.req.param("eventId");

    if (!eventId) {
      return c.json({ message: "Event ID is required" }, 400);
    }

    // Check if user is organizer
    const organizer = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        userId: user.id,
        eventGroup: "ORGANIZER",
      },
    });

    if (!organizer) {
      return c.json({ message: "Only organizers can view results" }, 403);
    }

    // Get all teams with their evaluation results
    const teams = await prisma.team.findMany({
      where: { eventId },
      include: {
        participants: {
          where: { eventGroup: "PRESENTER" },
          include: { user: { select: { name: true, image: true } } },
        },
        evaluationResults: {
          include: {
            criteria: true,
            committee: { select: { name: true } },
          },
        },
      },
    });

    // Get criteria to calculate weighted scores
    const criteria = await prisma.evaluationCriteria.findMany({
      where: { eventId },
    });

    // Calculate average scores
    const results = teams.map((team) => {
      const presenter = team.participants[0];
      const presenterName = presenter?.user.name || "Unknown";

      // Group results by committee member
      const byCommittee = new Map<string, { name: string; scores: Map<string, number> }>();

      team.evaluationResults.forEach((result) => {
        if (!byCommittee.has(result.committeeId)) {
          byCommittee.set(result.committeeId, {
            name: result.committee.name || "Unknown",
            scores: new Map(),
          });
        }
        byCommittee.get(result.committeeId)!.scores.set(result.criteriaId, result.score);
      });

      // Calculate weighted average for each committee member
      const committeeScores = Array.from(byCommittee.entries()).map(([committeeId, data]) => {
        let weightedSum = 0;
        let totalWeight = 0;

        criteria.forEach((crit) => {
          const score = data.scores.get(crit.id) ?? 0;
          const maxScore = crit.maxScore;
          const normalizedScore = (score / maxScore) * 100;
          weightedSum += (normalizedScore * crit.weightPercentage) / 100;
          totalWeight += crit.weightPercentage;
        });

        const avgScore = totalWeight > 0 ? weightedSum / (totalWeight / 100) : 0;

        return {
          committeeId,
          committeeName: data.name,
          avgScore: parseFloat(avgScore.toFixed(2)),
          scores: Object.fromEntries(data.scores),
        };
      });

      // Calculate overall average
      const overallAvg =
        committeeScores.length > 0
          ? parseFloat(
              (
                committeeScores.reduce((sum, c) => sum + c.avgScore, 0) / committeeScores.length
              ).toFixed(2),
            )
          : 0;

      return {
        teamId: team.id,
        teamName: team.teamName,
        presenterName,
        overallAverage: overallAvg,
        committeeScores,
      };
    });

    return c.json({ results, criteria });
  } catch (error) {
    console.error("Error fetching results:", error);
    return c.json({ message: "Failed to fetch results" }, 500);
  }
});

/**
 * GET /evaluation/event/:eventId/team/:teamId/status
 * Get grading status for a team (which committee members have graded)
 * Accessible by: COMMITTEE
 */
evaluationRoute.get("/event/:eventId/team/:teamId/status", async (c) => {
  try {
    const user = c.get("user");
    const eventId = c.req.param("eventId");
    const teamId = c.req.param("teamId");

    if (!eventId || !teamId) {
      return c.json({ message: "Event ID and Team ID are required" }, 400);
    }

    // Check if user is a committee member
    const participant = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        userId: user.id,
        eventGroup: "COMMITTEE",
      },
    });

    if (!participant) {
      return c.json({ message: "Access denied" }, 403);
    }

    // Get criteria count for this event
    const criteriaCount = await prisma.evaluationCriteria.count({
      where: { eventId },
    });

    // Get current user's grades
    const userGradesCount = await prisma.evaluationResult.count({
      where: {
        eventId,
        teamId,
        committeeId: user.id,
      },
    });

    const isGraded = userGradesCount === criteriaCount && criteriaCount > 0;

    return c.json({
      isGraded,
      gradesSubmitted: userGradesCount,
      totalCriteria: criteriaCount,
    });
  } catch (error) {
    console.error("Error fetching status:", error);
    return c.json({ message: "Failed to fetch status" }, 500);
  }
});

export default evaluationRoute;
