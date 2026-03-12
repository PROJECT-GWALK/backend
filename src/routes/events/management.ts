import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { prisma } from "../../lib/prisma.js";
import { getMinio } from "../../lib/minio.js";
import { createLog } from "../../lib/logger.js";
import sharp from "sharp";
import path from "node:path";
import type { User } from "../../generated/prisma/client.js";
import { specialRewardSchema, eventFileTypeSchema } from "../../lib/types.js";
import { normalizeEventName } from "./helpers.js";

const managementRoute = new Hono<{ Variables: { user: User | null } }>();

managementRoute.get("/me/drafts", async (c) => {
  const user = c.get("user");
  const drafts = await prisma.event.findMany({
    where: {
      status: "DRAFT",
      participants: { some: { userId: user?.id, eventGroup: "ORGANIZER", isLeader: true, deletedAt: null } },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, eventName: true, createdAt: true, imageCover: true },
  });
  return c.json({ message: "ok", events: drafts });
});

managementRoute.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const eventName = body.eventName;
  if (!eventName || typeof eventName !== "string") {
    return c.json({ message: "Event name is required" }, 400);
  }
  const normalizedName = normalizeEventName(eventName);
  if (!normalizedName.length) return c.json({ message: "Event name is required" }, 400);
  const exists = await prisma.event.findFirst({
    where: { eventName: { equals: normalizedName, mode: "insensitive" }, deletedAt: null },
  });
  if (exists) return c.json({ message: "Event name already exists" }, 409);
  const event = await prisma.event.create({ data: { eventName: normalizedName, status: "DRAFT" } });
  await prisma.eventParticipant.create({
    data: { eventId: event.id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true },
  });

  await createLog(
    user.id,
    "CREATE_EVENT",
    `Created event ${event.id} (${event.eventName})`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", event });
});

managementRoute.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const contentType = c.req.header("content-type") || "";
  let data: any = {};
  let newName: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    newName = typeof form["eventName"] === "string" ? (form["eventName"] as string) : undefined;
    if (newName) {
      const normalized = normalizeEventName(newName);
      if (!normalized.length) {
        return c.json({ message: "Event name is required" }, 400);
      }
      const dup = await prisma.event.findFirst({
        where: {
          id: { not: id },
          eventName: { equals: normalized, mode: "insensitive" },
          deletedAt: null,
        },
      });
      if (dup) return c.json({ message: "Event name already exists" }, 409);
      newName = normalized;
    }

    data.eventName = newName ?? event.eventName;
    if (typeof form["eventDescription"] === "string")
      data.eventDescription = form["eventDescription"] as string;
    if (typeof form["locationName"] === "string")
      data.locationName = form["locationName"] as string;
    if (typeof form["location"] === "string") data.location = form["location"] as string;
    if (typeof form["publicView"] === "string")
      data.publicView = (form["publicView"] as string) === "true";
    if (typeof form["hasCommittee"] === "string")
      data.hasCommittee = (form["hasCommittee"] as string) === "true";
    if (typeof form["gradingEnabled"] === "string")
      data.gradingEnabled = (form["gradingEnabled"] as string) === "true";
    if (typeof form["gradingDaysAfterEnd"] === "string") {
      const n = parseInt(form["gradingDaysAfterEnd"] as string);
      if (!Number.isNaN(n)) data.gradingDaysAfterEnd = Math.max(0, Math.floor(n));
    }
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
    if (typeof form["vrTeamCapEnabled"] === "string") {
      data.vrTeamCapEnabled = (form["vrTeamCapEnabled"] as string) === "true";
    }
    if (typeof form["vrTeamCapGuest"] === "string") {
      const n = parseInt(form["vrTeamCapGuest"] as string);
      if (!Number.isNaN(n)) data.vrTeamCapGuest = n;
    }
    if (typeof form["vrTeamCapCommittee"] === "string") {
      const n = parseInt(form["vrTeamCapCommittee"] as string);
      if (!Number.isNaN(n)) data.vrTeamCapCommittee = n;
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
      const normalized = normalizeEventName(newName);
      if (!normalized.length) {
        return c.json({ message: "Event name is required" }, 400);
      }
      const dup = await prisma.event.findFirst({
        where: {
          id: { not: id },
          eventName: { equals: normalized, mode: "insensitive" },
          deletedAt: null,
        },
      });
      if (dup) return c.json({ message: "Event name already exists" }, 409);
      newName = normalized;
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
      maxTeamMembers:
        typeof body.maxTeamMembers === "number" ? body.maxTeamMembers : event.maxTeamMembers,
      maxTeams: typeof body.maxTeams === "number" ? body.maxTeams : event.maxTeams,
      virtualRewardGuest:
        typeof body.virtualRewardGuest === "number"
          ? body.virtualRewardGuest
          : event.virtualRewardGuest,
      virtualRewardCommittee:
        typeof body.virtualRewardCommittee === "number"
          ? body.virtualRewardCommittee
          : event.virtualRewardCommittee,
      vrTeamCapEnabled:
        typeof body.vrTeamCapEnabled === "boolean" ? body.vrTeamCapEnabled : event.vrTeamCapEnabled,
      vrTeamCapGuest:
        typeof body.vrTeamCapGuest === "number" ? body.vrTeamCapGuest : event.vrTeamCapGuest,
      vrTeamCapCommittee:
        typeof body.vrTeamCapCommittee === "number"
          ? body.vrTeamCapCommittee
          : event.vrTeamCapCommittee,
      hasCommittee: typeof body.hasCommittee === "boolean" ? body.hasCommittee : event.hasCommittee,
      gradingEnabled:
        typeof body.gradingEnabled === "boolean" ? body.gradingEnabled : event.gradingEnabled,
      gradingDaysAfterEnd:
        typeof body.gradingDaysAfterEnd === "number"
          ? Math.max(0, Math.floor(body.gradingDaysAfterEnd))
          : event.gradingDaysAfterEnd,
      unitReward: typeof body.unitReward === "string" ? body.unitReward : event.unitReward,
    } as any;
    if ("imageCover" in body)
      (data as any).imageCover = body.imageCover === "null" ? null : body.imageCover;
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
    // Validate
    const validatedFileTypes: z.infer<typeof eventFileTypeSchema>[] = [];
    for (const ft of fileTypesData) {
      const result = eventFileTypeSchema.safeParse(ft);
      if (!result.success) {
        return c.json({ message: "Invalid submission requirement data", errors: result.error }, 400);
      }
      validatedFileTypes.push(result.data);
    }

    const current = await prisma.eventFileType.findMany({
      where: { eventId: id, deletedAt: null },
      select: { id: true },
    });
    const currentIds = current.map((c) => c.id);
    const incomingIds = validatedFileTypes
      .filter((f) => f.id && currentIds.includes(f.id))
      .map((f) => f.id);

    const toDelete = currentIds.filter((cid) => !incomingIds.includes(cid));
    const toUpdate = validatedFileTypes.filter((f) => f.id && currentIds.includes(f.id));
    const toCreate = validatedFileTypes.filter((f) => !f.id || !currentIds.includes(f.id));

    await prisma.$transaction([
      // Soft delete
      prisma.eventFileType.updateMany({ 
        where: { id: { in: toDelete } },
        data: { deletedAt: new Date() }
      }),
      ...toUpdate.map((f) =>
        prisma.eventFileType.update({
          where: { id: f.id },
          data: {
            name: f.name,
            description: f.description,
            allowedFileTypes: f.allowedFileTypes,
            isRequired: f.isRequired,
          },
        }),
      ),
      prisma.eventFileType.createMany({
        data: toCreate.map((f) => ({
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
  const sj = (
    "startJoinDate" in data ? (data as any).startJoinDate : event.startJoinDate
  ) as Date | null;
  const ej = ("endJoinDate" in data ? (data as any).endJoinDate : event.endJoinDate) as Date | null;
  if (sj && ej && sj > ej)
    return c.json({ message: "Submit period invalid: start after end" }, 400);
  if (sj && sv && sj >= sv)
    return c.json({ message: "Submission start must be before event start" }, 400);
  if (ej && sv && ej >= sv)
    return c.json({ message: "Submission end must be before event start" }, 400);

  const updated = await prisma.event.update({ where: { id }, data });

  // Update existing participants if rewards changed
  if (typeof data.virtualRewardGuest === "number") {
    await prisma.eventParticipant.updateMany({
      where: { eventId: id, eventGroup: "GUEST", deletedAt: null },
      data: { virtualReward: data.virtualRewardGuest },
    });
  }
  if (typeof data.virtualRewardCommittee === "number") {
    await prisma.eventParticipant.updateMany({
      where: { eventId: id, eventGroup: "COMMITTEE", deletedAt: null },
      data: { virtualReward: data.virtualRewardCommittee },
    });
  }

  await createLog(
    user.id,
    "UPDATE_EVENT_ORGANIZER",
    `Updated event ${id}`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", event: updated });
});

managementRoute.put("/:id/public-view", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const leader = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true, deletedAt: null },
  });
  if (!leader) return c.json({ message: "Forbidden" }, 403);
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const pv = typeof body.publicView === "boolean" ? body.publicView : undefined;
  if (typeof pv === "undefined") return c.json({ message: "publicView is required" }, 400);
  const updated = await prisma.event.update({ where: { id }, data: { publicView: pv } });

  await createLog(
    user.id,
    "TOGGLE_PUBLIC_VIEW",
    `Set public view of event ${id} to ${pv}`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", event: updated });
});

managementRoute.post("/:id/special-rewards", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const eventId = c.req.param("id");
  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: eventId, userId: user.id, eventGroup: "ORGANIZER", deletedAt: null },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  const contentType = c.req.header("content-type") || "";
  let data: any = {};
  let file: File | undefined;
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    if (typeof form["name"] === "string") data.name = String(form["name"]);
    if (typeof form["description"] === "string") data.description = String(form["description"]);
    if (typeof form["allowGuestVote"] === "string") {
      data.allowGuestVote = form["allowGuestVote"] === "true";
    }
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
    if (typeof body.allowGuestVote === "boolean") data.allowGuestVote = body.allowGuestVote;
    if (typeof body.allowGuestVote === "string") {
      data.allowGuestVote = body.allowGuestVote === "true";
    }
  }

  const validation = specialRewardSchema.safeParse(data);
  if (!validation.success) {
    return c.json({ message: "Invalid reward data", errors: validation.error }, 400);
  }
  const { name, description, image, allowGuestVote } = validation.data;

  const created = await prisma.specialReward.create({
    data: { eventId, name, description, image, allowGuestVote },
  });

  // await createLog(
  //   user.id,
  //   "CREATE_SPECIAL_REWARD",
  //   `Created special reward ${created.id} (${created.name}) for event ${eventId}`,
  //   c.req.header("x-forwarded-for"),
  //   c.req.header("user-agent")
  // );

  return c.json({ message: "ok", reward: created });
});

managementRoute.put("/:id/special-rewards/:rewardId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const rewardId = c.req.param("rewardId");
  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  const reward = await prisma.specialReward.findFirst({ where: { id: rewardId, deletedAt: null } });
  if (!reward || reward.eventId !== eventId) return c.json({ message: "Reward not found" }, 404);

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  const contentType = c.req.header("content-type") || "";
  let data: any = {};
  let file: File | undefined;
  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    if (typeof form["name"] === "string") data.name = String(form["name"]);
    if (typeof form["description"] === "string") data.description = String(form["description"]);
    if (typeof form["allowGuestVote"] === "string") {
      data.allowGuestVote = form["allowGuestVote"] === "true";
    }
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
    if (typeof body.allowGuestVote === "boolean") data.allowGuestVote = body.allowGuestVote;
    if (typeof body.allowGuestVote === "string") {
      data.allowGuestVote = body.allowGuestVote === "true";
    }
  }

  const validation = specialRewardSchema.safeParse(data);
  if (!validation.success) {
    return c.json({ message: "Invalid reward data", errors: validation.error }, 400);
  }
  const { name, description, image, allowGuestVote } = validation.data;

  const updatedReward = await prisma.specialReward.update({
    where: { id: rewardId },
    data: { name, description, image, allowGuestVote },
  });

  // await createLog(
  //   user.id,
  //   "UPDATE_SPECIAL_REWARD",
  //   `Updated special reward ${rewardId} (${updatedReward.name}) for event ${eventId}`,
  //   c.req.header("x-forwarded-for"),
  //   c.req.header("user-agent")
  // );

  return c.json({ message: "ok", reward: updatedReward });
});

managementRoute.delete("/:id/special-rewards/:rewardId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const rewardId = c.req.param("rewardId");
  const event = await prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user?.id, eventGroup: "ORGANIZER", deletedAt: null },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);

  const reward = await prisma.specialReward.findFirst({ where: { id: rewardId, deletedAt: null } });
  if (!reward || reward.eventId !== eventId) return c.json({ message: "Reward not found" }, 404);

  if (!user) return c.json({ message: "Unauthorized" }, 401);

  // Soft delete
  await prisma.specialReward.update({ 
    where: { id: rewardId },
    data: { deletedAt: new Date() }
  });

  // await createLog(
  //   user.id,
  //   "DELETE_SPECIAL_REWARD",
  //   `Deleted special reward ${rewardId} from event ${eventId}`,
  //   c.req.header("x-forwarded-for"),
  //   c.req.header("user-agent")
  // );

  return c.json({ message: "ok", deletedId: rewardId });
});

managementRoute.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const leader = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true, deletedAt: null },
  });
  if (!leader) return c.json({ message: "Forbidden" }, 403);
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  
  // Soft delete event
  await prisma.event.update({ 
    where: { id },
    data: { deletedAt: new Date() }
  });

  await createLog(
    user.id,
    "DELETE_EVENT_ORGANIZER",
    `Deleted event ${id} (${event.eventName})`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", deletedId: id });
});

managementRoute.post("/:id/publish", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findFirst({ where: { id, deletedAt: null } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const leader = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user?.id, eventGroup: "ORGANIZER", isLeader: true, deletedAt: null },
  });
  if (!leader) return c.json({ message: "Forbidden" }, 403);
  if (!user) return c.json({ message: "Unauthorized" }, 401);
  const updated = await prisma.event.update({ where: { id }, data: { status: "PUBLISHED" } });

  await createLog(
    user.id,
    "PUBLISH_EVENT",
    `Published event ${id} (${updated.eventName})`,
    c.req.header("x-forwarded-for"),
    c.req.header("user-agent")
  );

  return c.json({ message: "ok", event: updated });
});

managementRoute.get("/:eventId/export-data", async (c) => {
  const eventId = c.req.param("eventId");
  const user = c.get("user");
  if (!user) return c.json({ message: "Unauthorized" }, 401);

  // Check role: Must be Organizer (in participants) or Admin
  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user.id, eventGroup: "ORGANIZER", deletedAt: null },
  });

  if (!participant && user.role !== "ADMIN") {
    return c.json({ message: "Forbidden" }, 403);
  }

  try {
    const teams = await prisma.team.findMany({
      where: { eventId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { 
        id: true, 
        teamName: true, 
        createdAt: true,
        participants: {
          where: { deletedAt: null },
          select: { userId: true }
        }
      },
    });

    const participants = await prisma.eventParticipant.findMany({
      where: { eventId, deletedAt: null },
      select: { userId: true, eventGroup: true, user: { select: { name: true } } },
    });
    
    const userMap: Record<string, { role: string; name: string }> = {};
    participants.forEach((p) => {
      if (p.eventGroup) userMap[p.userId] = { role: p.eventGroup, name: p.user.name || "Unknown" };
    });

    const teamRewards = await prisma.teamReward.findMany({
      where: { eventId, deletedAt: null },
    });

    const teamRewardCategories = await prisma.teamRewardCategory.findMany({
      where: { eventId, deletedAt: null },
    });

    const specialRewards = await prisma.specialReward.findMany({
      where: { eventId, deletedAt: null },
    });

    const specialRewardVotes = await prisma.specialRewardVote.findMany({
      where: { reward: { eventId }, deletedAt: null },
      include: { reward: true },
    });

    const comments = await prisma.comment.findMany({
      where: { eventId, deletedAt: null },
      include: { user: { select: { name: true } } },
    });

    const evaluationCriteria = await prisma.evaluationCriteria.findMany({
      where: { eventId, deletedAt: null },
      orderBy: { sortOrder: "asc" },
    });

    const evaluationResults = await prisma.evaluationResult.findMany({
      where: { eventId, deletedAt: null },
      include: { criteria: true },
    });
    
    return c.json({
      teams,
      userMap,
      teamRewards,
      teamRewardCategories,
      specialRewards,
      specialRewardVotes,
      comments,
      evaluationCriteria,
      evaluationResults,
    });
  } catch (error) {
    console.error("Export error:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

export default managementRoute;
