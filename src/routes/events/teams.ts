import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../../lib/prisma.js";
import { getMinio } from "../../lib/minio.js";
import { createLog } from "../../lib/logger.js";
import sharp from "sharp";
import path from "node:path";
import type { User } from "../../generated/prisma/client.js";
import {
  idParamSchema,
  eventAndTeamIdParamSchema,
  createTeamSchema,
  updateTeamSchema,
  addTeamMemberSchema,
} from "../../lib/types.js";

const teamsRoute = new Hono<{ Variables: { user: User | null } }>();

teamsRoute.post("/:id/teams", zValidator("param", idParamSchema), async (c) => {
  const user = c.get("user");
  const { id: eventId } = c.req.valid("param");

  const contentType = c.req.header("content-type") || "";
  let dataToValidate: any = {};
  let file: File | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    dataToValidate = {
      teamName: form["teamName"],
      description: form["description"],
      imageCover: typeof form["imageCover"] === "string" ? form["imageCover"] : undefined,
    };
    if (form["imageCover"] instanceof File) {
      file = form["imageCover"] as File;
    }
  } else {
    dataToValidate = await c.req.json().catch(() => ({}));
  }

  const result = createTeamSchema.safeParse(dataToValidate);
  if (!result.success) {
    return c.json({ message: "Invalid input", errors: result.error }, 400);
  }

  const { teamName, description } = result.data;
  let { imageCover } = result.data;

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id },
  });
  if (!participant) return c.json({ message: "Forbidden" }, 403);

  if (participant.teamId) {
    return c.json({ message: "You are already in a team" }, 400);
  }

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);

  // Check submission period
  const now = new Date();
  if (event.startJoinDate && now < event.startJoinDate) {
    return c.json({ message: "Not in submission period" }, 400);
  }
  if (event.endJoinDate && now > event.endJoinDate) {
    return c.json({ message: "Submission period has ended" }, 400);
  }

  if (event.maxTeams) {
    const currentTeams = await prisma.team.count({ where: { eventId, deletedAt: null } });
    if (currentTeams >= event.maxTeams) {
      return c.json({ message: "Max teams reached for this event" }, 400);
    }
  }

  if (file) {
    if (file.size > 50 * 1024 * 1024) {
      return c.json({ message: "File size exceeds 50MB" }, 400);
    }
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
      imageCover,
    },
  });

  await prisma.eventParticipant.update({
    where: { id: participant.id },
    data: { teamId: team.id, isLeader: true },
  });

  await createLog(
    user.id,
    "CREATE_TEAM",
    `Created team ${team.id} (${team.teamName}) in event ${eventId}`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", team });
});

teamsRoute.put("/:id/teams/:teamId", zValidator("param", eventAndTeamIdParamSchema), async (c) => {
  const user = c.get("user");
  const { id: eventId, teamId } = c.req.valid("param");
  const contentType = c.req.header("content-type") || "";
  let dataToValidate: any = {};
  let file: File | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    dataToValidate = {
      teamName: form["teamName"],
      description: form["description"],
      imageCover: typeof form["imageCover"] === "string" ? form["imageCover"] : undefined,
    };
    if (form["imageCover"] instanceof File) {
      file = form["imageCover"] as File;
    }
  } else {
    dataToValidate = await c.req.json().catch(() => ({}));
  }

  const result = updateTeamSchema.safeParse(dataToValidate);
  if (!result.success) {
    return c.json({ message: "Invalid input", errors: result.error }, 400);
  }

  const { teamName, description } = result.data;
  let { imageCover } = result.data;

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, deletedAt: null },
  });

  // Permission Check:
  // Any member of THIS team can edit.
  if (!participant) return c.json({ message: "Forbidden" }, 403);

  const isMember = participant.teamId === teamId;

  if (!isMember) {
    return c.json({ message: "Forbidden" }, 403);
  }

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);

  // Check submission period
  const now = new Date();
  if (event.startJoinDate && now < event.startJoinDate) {
    return c.json({ message: "Not in submission period" }, 400);
  }
  if (event.endJoinDate && now > event.endJoinDate) {
    return c.json({ message: "Submission period has ended" }, 400);
  }

  if (file) {
    if (file.size > 50 * 1024 * 1024) {
      return c.json({ message: "File size exceeds 50MB" }, 400);
    }
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
  if (teamName) data.teamName = teamName.trim();
  if (description !== undefined) data.description = description;
  if (imageCover !== undefined) data.imageCover = imageCover === "null" ? null : imageCover;

  const team = await prisma.team.update({
    where: { id: teamId },
    data,
  });

  await createLog(
    user.id,
    "UPDATE_TEAM",
    `Updated team ${teamId} (${team.teamName}) in event ${eventId}`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", team });
});

teamsRoute.post(
  "/:id/teams/:teamId/members",
  zValidator("param", eventAndTeamIdParamSchema),
  zValidator("json", addTeamMemberSchema),
  async (c) => {
    const user = c.get("user");
    const { id: eventId, teamId } = c.req.valid("param");
    const { userId } = c.req.valid("json");

    const requester = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user?.id, deletedAt: null },
    });

    if (!requester || requester.teamId !== teamId) {
      return c.json({ message: "Forbidden" }, 403);
    }

    // Only leader can add members
    if (!requester.isLeader) {
      return c.json({ message: "Only leader can add members" }, 403);
    }

    if (!user) return c.json({ message: "Unauthorized" }, 401);

    const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event) return c.json({ message: "Event not found" }, 404);

    // Check submission period
    const now = new Date();
    if (event.startJoinDate && now < event.startJoinDate) {
      return c.json({ message: "Not in submission period" }, 400);
    }
    if (event.endJoinDate && now > event.endJoinDate) {
      return c.json({ message: "Submission period has ended" }, 400);
    }

    if (event.maxTeamMembers !== null && event.maxTeamMembers !== undefined) {
      const currentMembers = await prisma.eventParticipant.count({
        where: { teamId, deletedAt: null },
      });
      if (currentMembers >= event.maxTeamMembers) {
        return c.json({ message: "Max team members reached" }, 400);
      }
    }

    const target = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: userId, deletedAt: null },
    });

    if (!target) {
      const userExists = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true },
      });
      if (!userExists) return c.json({ message: "User not found" }, 404);

      await prisma.eventParticipant.create({
        data: {
          eventId,
          userId,
          eventGroup: "PRESENTER",
          teamId,
          isLeader: false,
          virtualReward: 0,
        },
      });

      await createLog(
        user.id,
        "ADD_TEAM_MEMBER",
        `Added user ${userId} to team ${teamId}`,
        c.req.header("x-forwarded-for"),
        c.req.header("user-agent")
      );

      return c.json({ message: "ok" });
    }

    if (target.teamId) return c.json({ message: "User already in a team" }, 400);
    if (target.eventGroup !== "PRESENTER")
      return c.json({ message: "User is not a presenter" }, 400);

    await prisma.eventParticipant.update({
      where: { id: target.id },
      data: { teamId },
    });

    await createLog(
      user.id,
      "ADD_TEAM_MEMBER",
      `Added user ${userId} (id: ${target.id}) to team ${teamId}`,
      c.req.header("x-forwarded-for"),
      c.req.header("user-agent")
    );

    return c.json({ message: "ok" });
  },
);

teamsRoute.get(
  "/:id/teams/:teamId/comments",
  zValidator("param", eventAndTeamIdParamSchema),
  async (c) => {
    const user = c.get("user");
    const { id: eventId, teamId } = c.req.valid("param");

    if (!user) return c.json({ message: "Unauthorized" }, 401);

    const participant = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user.id, deletedAt: null },
      include: { team: { where: { deletedAt: null } }, event: { select: { startView: true, endJoinDate: true } } },
    });

    if (!participant) return c.json({ message: "Forbidden" }, 403);

    const now = new Date();
    const eventStarted = !participant.event.startView || now >= participant.event.startView;
    const submissionEnded = participant.event.endJoinDate
      ? now >= participant.event.endJoinDate
      : false;

    if (
      !eventStarted &&
      participant.eventGroup !== "ORGANIZER" &&
      (participant.eventGroup !== "COMMITTEE" || !submissionEnded) &&
      participant.teamId !== teamId
    ) {
      return c.json({ message: "Forbidden" }, 403);
    }

    let comments: any[] = [];

    // 1. Team Members & Organizer see all comments from Committee/Guest
    if (participant.teamId === teamId || participant.eventGroup === "ORGANIZER") {
      comments = await prisma.comment.findMany({
        where: {
          eventId,
          teamId,
          deletedAt: null,
          user: {
            participants: {
              some: {
                eventId,
                eventGroup: { in: ["COMMITTEE", "GUEST"] },
                deletedAt: null,
              },
            },
            deletedAt: null,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              image: true,
              participants: {
                where: { eventId, deletedAt: null },
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
          deletedAt: null,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              image: true,
              participants: {
                where: { eventId, deletedAt: null },
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
        username: comment.user.username,
        name: comment.user.name,
        image: comment.user.image,
        role: comment.user.participants[0]?.eventGroup || "UNKNOWN",
      },
    }));

    return c.json({ message: "ok", comments: formattedComments });
  },
);

teamsRoute.get("/:id/teams/:teamId", zValidator("param", eventAndTeamIdParamSchema), async (c) => {
  const user = c.get("user");
  const { id: eventId, teamId } = c.req.valid("param");

  try {
    const event = await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: {
        startView: true,
        status: true,
        publicView: true,
        isHidden: true,
        endJoinDate: true,
      },
    });
    if (!event) return c.json({ message: "Event not found" }, 404);
    if (event.status !== "PUBLISHED") return c.json({ message: "Event not published" }, 403);
    if (event.isHidden) return c.json({ message: "Forbidden" }, 403);

    let canView = event.publicView;
    if (!canView && user) {
      const p = await prisma.eventParticipant.findFirst({
        where: { eventId, userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (p) canView = true;
    }
    if (!canView) return c.json({ message: "Forbidden" }, 403);

    const team = await prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
      include: {
        participants: {
        where: { deletedAt: null },
        include: {
            user: { select: { id: true, name: true, username: true, image: true, deletedAt: true } },
          },
      },
      files: { where: { deletedAt: null }, include: { fileType: true } },
      },
    });

    if (!team || team.eventId !== eventId) {
      return c.json({ message: "Team not found" }, 404);
    }

    const now = new Date();
    const eventStarted = !event.startView || now >= event.startView;
    if (!eventStarted) {
      if (!user) return c.json({ message: "Unauthorized" }, 401);

      const isOrganizer = await prisma.eventParticipant.findFirst({
        where: {
          eventId,
          userId: user.id,
          eventGroup: "ORGANIZER",
          deletedAt: null,
        },
        select: { id: true },
      });

      const isCommittee = await prisma.eventParticipant.findFirst({
        where: {
          eventId,
          userId: user.id,
          eventGroup: { in: ["COMMITTEE", "GUEST"] },
          deletedAt: null,
        },
        select: { id: true },
      });

      const submissionEnded = event.endJoinDate ? now >= event.endJoinDate : false;

      const isMember = team.participants.some((p) => p.userId === user.id && !p.user.deletedAt);
      if (!isOrganizer && (!isCommittee || !submissionEnded) && !isMember) {
        return c.json({ message: "Forbidden" }, 403);
      }
    }

    // Get My Rewards info
    let myReward = 0;
    let mySpecialRewards: string[] = [];
    let myComment = "";

    if (user) {
      const reward = await prisma.teamReward.findFirst({
        where: { eventId, teamId, giverId: user.id, deletedAt: null },
      });
      if (reward) myReward = reward.reward;

      const myParticipant = await prisma.eventParticipant.findFirst({
        where: { eventId, userId: user.id, eventGroup: { in: ["COMMITTEE", "GUEST"] }, deletedAt: null },
      });

      if (myParticipant) {
        const myVotes = await prisma.specialRewardVote.findMany({
          where: { committeeId: myParticipant.id, teamId, deletedAt: null },
          select: { rewardId: true },
        });
        mySpecialRewards = myVotes.map((v) => v.rewardId);
      }

      const comment = await prisma.comment.findFirst({
        where: { eventId, teamId, userId: user.id, deletedAt: null },
      });
      if (comment) myComment = comment.content;
    }

    // Get Total VR
    const totalReward = await prisma.teamReward.aggregate({
      where: { eventId, teamId, deletedAt: null },
      _sum: { reward: true },
    });
    const totalCategoryReward = await prisma.teamRewardCategory.aggregate({
      where: { eventId, teamId, deletedAt: null },
      _sum: { amount: true },
    });
    const totalVr = (totalReward._sum.reward || 0) + (totalCategoryReward._sum.amount || 0);

    return c.json({
      message: "ok",
      team: {
        ...team,
        totalVr,
        myReward,
        mySpecialRewards,
        myComment,
      },
    });
  } catch (error) {
    console.error("Error fetching team:", error);
    return c.json({ message: "Team not found or invalid ID" }, 404);
  }
});

teamsRoute.delete("/:id/teams/:teamId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, deletedAt: null },
  });
  // Only leader can delete
  if (!participant || participant.teamId !== teamId || !participant.isLeader) {
    // Or organizer?
    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
    });
    if (!organizer) return c.json({ message: "Forbidden" }, 403);
  }

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  // Unlink participants first to prevent cascade delete
  await prisma.eventParticipant.updateMany({
    where: { teamId },
    data: { teamId: null, isLeader: false },
  });

  await prisma.team.update({
    where: { id: teamId },
    data: { deletedAt: new Date() },
  });

  await createLog(
    user.id,
    "DELETE_TEAM",
    `Deleted team ${teamId} from event ${eventId}`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok" });
});

teamsRoute.get("/:id/teams", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const event = await prisma.event.findFirst({
    where: { id: eventId, deletedAt: null },
    select: { startView: true, endJoinDate: true },
  });
  if (!event) return c.json({ message: "Event not found" }, 404);

  const organizer = user
    ? await prisma.eventParticipant.findFirst({
        where: { eventId, userId: user.id, eventGroup: "ORGANIZER", deletedAt: null },
        select: { id: true },
      })
    : null;

  const committee = user
    ? await prisma.eventParticipant.findFirst({
        where: { eventId, userId: user.id, eventGroup: { in: ["COMMITTEE", "GUEST"] }, deletedAt: null },
        select: { id: true },
      })
    : null;

  const now = new Date();
  const eventStarted = !event.startView || now >= event.startView;
  const submissionEnded = event.endJoinDate ? now >= event.endJoinDate : false;
  const canViewAll = !!organizer || eventStarted || (!!committee && submissionEnded);

  const teams = await prisma.team.findMany({
    where: canViewAll ? { eventId, deletedAt: null } : { eventId, participants: { some: { userId: user?.id, deletedAt: null } }, deletedAt: null },
    include: {
      participants: { where: { deletedAt: null }, include: { user: { select: { id: true, name: true, username: true, image: true } } } },
      files: { where: { deletedAt: null }, include: { fileType: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (teams.length === 0) return c.json({ message: "ok", teams: [] });

  const teamIds = teams.map((t) => t.id);
  const rewards = await prisma.teamReward.groupBy({
    by: ["teamId"],
    where: { eventId, teamId: { in: teamIds }, deletedAt: null },
    _sum: { reward: true },
  });

  const categoryRewards = await prisma.teamRewardCategory.groupBy({
    by: ["teamId"],
    where: { eventId, teamId: { in: teamIds }, deletedAt: null },
    _sum: { amount: true },
  });

  const rewardMap = new Map<string, number>();
  rewards.forEach((r) =>
    rewardMap.set(r.teamId, (rewardMap.get(r.teamId) || 0) + (r._sum.reward || 0)),
  );
  categoryRewards.forEach((r) =>
    rewardMap.set(r.teamId, (rewardMap.get(r.teamId) || 0) + (r._sum.amount || 0)),
  );

  const myRewardsMap = new Map<string, number>();
  const myCategoryRewardsMap = new Map<string, number>();
  const mySpecialRewardsMap = new Map<string, string[]>();
  const myCommentsMap = new Map<string, string>();
  const myGradedMap = new Map<string, boolean>();

  if (user) {
    const myRewards = await prisma.teamReward.findMany({
      where: { eventId, giverId: user.id, deletedAt: null },
    });
    myRewards.forEach((r) => {
      myRewardsMap.set(r.teamId, r.reward);
    });

    const myCategoryRewards = await prisma.teamRewardCategory.groupBy({
      by: ["teamId"],
      where: { eventId, giverId: user.id, deletedAt: null },
      _sum: { amount: true },
    });
    myCategoryRewards.forEach((r) => {
      myCategoryRewardsMap.set(r.teamId, r._sum.amount || 0);
    });

    const myParticipant = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user.id, eventGroup: { in: ["COMMITTEE", "GUEST"] }, deletedAt: null },
    });

    if (myParticipant) {
      const myVotes = await prisma.specialRewardVote.findMany({
        where: { committeeId: myParticipant.id, deletedAt: null },
        include: { reward: true },
      });
      myVotes.forEach((v) => {
        if (v.teamId) {
          const existing = mySpecialRewardsMap.get(v.teamId) || [];
          existing.push(v.reward.id); // Use ID for easier frontend matching
          mySpecialRewardsMap.set(v.teamId, existing);
        }
      });
    }

    // Fetch myComment for each team
    const myComments = await prisma.committeeFeedback.findMany({
      where: { eventId, committeeId: user.id, deletedAt: null },
    });
    myComments.forEach((c) => {
      myCommentsMap.set(c.teamId, c.content);
    });

    // Fetch myGraded status for each team (count grades by this user)
    const criteriaCount = await prisma.evaluationCriteria.count({
      where: { eventId, deletedAt: null },
    });
    const myGrades = await prisma.evaluationResult.groupBy({
      by: ["teamId"],
      where: { eventId, committeeId: user.id, deletedAt: null }, // Added deletedAt check
      _count: { id: true },
    });
    myGrades.forEach((g) => {
      // User is considered to have graded if they submitted grades for all criteria
      myGradedMap.set(g.teamId, g._count.id >= criteriaCount && criteriaCount > 0);
    });
  }

  const teamsWithVr = teams.map((t) => ({
    ...t,
    totalVr: rewardMap.get(t.id) || 0,
    myReward: (myRewardsMap.get(t.id) || 0) + (myCategoryRewardsMap.get(t.id) || 0),
    mySpecialRewards: mySpecialRewardsMap.get(t.id) || [],
    myComment: myCommentsMap.get(t.id) || "",
    myGraded: myGradedMap.get(t.id) || false,
  }));

  return c.json({ message: "ok", teams: teamsWithVr });
});

teamsRoute.post("/:id/teams/:teamId/files", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, deletedAt: null },
  });
  if (!participant || participant.teamId !== teamId) {
    return c.json({ message: "Forbidden" }, 403);
  }

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const form = await c.req.parseBody();
  const fileTypeId = form["fileTypeId"] as string;
  const file = form["file"] as File | undefined;
  const url = form["url"] as string | undefined;

  if (!fileTypeId || (!file && !url)) {
    return c.json({ message: "Missing file or url or fileTypeId" }, 400);
  }

  const fileType = await prisma.eventFileType.findFirst({
    where: { id: fileTypeId, eventId, deletedAt: null },
  });
  if (!fileType) return c.json({ message: "Invalid file type" }, 400);

  // Check if file already exists for this team and fileType
  const existingFile = await prisma.teamFile.findFirst({
    where: { teamId, fileTypeId, deletedAt: null },
  });

  if (existingFile) {
    // Delete existing record (MinIO file deletion is optional/deferred, but we remove DB record)
    await prisma.teamFile.update({
      where: { id: existingFile.id },
      data: { deletedAt: new Date() },
    });
  }

  if (file && file.size > 50 * 1024 * 1024) {
    return c.json({ message: "File size exceeds 50MB limit" }, 400);
  }

  let fileUrl = "";
  if (file) {
    const minio = getMinio();
    const bucket = process.env.OBJ_BUCKET!;
    // Sanitize filename to be safe but recognizable
    const safeName = path.parse(file.name).name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const ext = path.extname(file.name);
    const objectName = `teams/${teamId}/${safeName}-${Date.now()}${ext}`;
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

  await createLog(
    user.id,
    "UPLOAD_TEAM_FILE",
    `Uploaded file for team ${teamId} (Type: ${fileTypeId})`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", teamFile });
});

teamsRoute.delete("/:id/teams/:teamId/files/:fileTypeId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");
  const fileTypeId = c.req.param("fileTypeId");

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, deletedAt: null },
  });
  if (!participant || participant.teamId !== teamId) {
    return c.json({ message: "Forbidden" }, 403);
  }

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  // Allow any team member to delete, matching upload permissions
  await prisma.teamFile.updateMany({
    where: { teamId, fileTypeId },
    data: { deletedAt: new Date() },
  });

  await createLog(
    user.id,
    "DELETE_TEAM_FILE",
    `Deleted file for team ${teamId} (Type: ${fileTypeId})`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok" });
});

teamsRoute.delete("/:id/teams/:teamId/members/:userId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const teamId = c.req.param("teamId");
  const targetUserId = c.req.param("userId");

  const requester = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, deletedAt: null },
  });

  if (!requester || requester.teamId !== teamId) {
    return c.json({ message: "Forbidden" }, 403);
  }

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);

  // Check submission period
  const now = new Date();
  if (event.startJoinDate && now < event.startJoinDate) {
    return c.json({ message: "Not in submission period" }, 400);
  }
  if (event.endJoinDate && now > event.endJoinDate) {
    return c.json({ message: "Submission period has ended" }, 400);
  }

  if (!requester.isLeader && user?.id !== targetUserId) {
    return c.json({ message: "Only leader can remove other members" }, 403);
  }

  const target = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: targetUserId, deletedAt: null },
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

  await createLog(
    user.id,
    "REMOVE_TEAM_MEMBER",
    `Removed user ${targetUserId} from team ${teamId}`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok" });
});

export default teamsRoute;
