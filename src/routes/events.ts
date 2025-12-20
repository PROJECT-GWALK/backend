import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.js";
import type { User } from "@prisma/client";
import { getMinio } from "../lib/minio.js";
import { prisma } from "../lib/prisma.js";
import { createHmac } from "crypto";
import sharp from "sharp";
import path from "node:path";

const eventsRoute = new Hono<{ Variables: { user: User } }>();

eventsRoute.use("*", authMiddleware);

const INVITE_SECRET = process.env.INVITE_SECRET || "dev-secret";
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
      participants: { where: { userId: user.id }, select: { eventGroup: true, isLeader: true } },
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
  }));
  return c.json({ message: "ok", events: payload });
});

eventsRoute.get("/me", async (c) => {
  const user = c.get("user");
  const events = await prisma.event.findMany({
    where: { status: { not: "DRAFT" }, participants: { some: { userId: user.id } } },
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
      participants: { where: { userId: user.id }, select: { eventGroup: true, isLeader: true } },
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
  }));
  return c.json({ message: "ok", events: payload });
});

eventsRoute.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const event = await prisma.event.findUnique({
    where: { id },
    include: { fileTypes: true, specialRewards: true, participants: { include: { user: true } } },
  });
  if (!event) return c.json({ message: "Event not found" }, 404);

  if (event.status === "DRAFT") {
    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER" },
    });
    if (!organizer) return c.json({ message: "Forbidden" }, 403);
    return c.json({ message: "ok", event });
  }

  if (event.publicView) return c.json({ message: "ok", event });

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user.id },
  });
  if (!participant) return c.json({ message: "Forbidden" }, 403);
  return c.json({ message: "ok", event });
});

eventsRoute.get("/:id/invite/sign", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");
  const role = c.req.query("role") as keyof typeof roleMap | undefined;
  if (!role || !(role in roleMap)) return c.json({ message: "invalid role" }, 400);
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
  
  const existing = await prisma.eventParticipant.findFirst({
    where: { eventId, userId: user.id },
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

  const created = await prisma.eventParticipant.create({
    data: {
      eventId,
      userId: user.id,
      eventGroup: targetRole,
      isLeader: false,
    },
  });
  return c.json({ message: "ok", participant: created });
});

eventsRoute.get("/:id/participants", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  const participants = await prisma.eventParticipant.findMany({
    where: { eventId: id },
    include: { user: true, team: true },
  });
  return c.json({ message: "ok", participants });
});

eventsRoute.put("/:id/participants/:pid", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const pid = c.req.param("pid");
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER" },
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
  if (eg && ["ORGANIZER", "PRESENTER", "COMMITTEE", "GUEST"].includes(eg)) data.eventGroup = eg;
  if (typeof body?.isLeader === "boolean") data.isLeader = body.isLeader;
  if (typeof body?.virtualReward === "number") data.virtualReward = Math.max(0, body.virtualReward);
  if (body?.teamId === null) data.teamId = null;
  else if (typeof body?.teamId === "string" && body.teamId.length > 0) data.teamId = body.teamId;
  const existing = await prisma.eventParticipant.findFirst({ where: { id: pid, eventId: id } });
  if (!existing) return c.json({ message: "Participant not found" }, 404);
  if (existing.eventGroup === "ORGANIZER") {
    if (!organizer.isLeader) {
      return c.json({ message: "Only organizer leader can manage organizer group" }, 403);
    }
    if (existing.userId === user.id) {
      return c.json({ message: "Organizer leader cannot manage self" }, 403);
    }
    if (typeof body?.isLeader === "boolean") {
      return c.json({ message: "Cannot change organizer leader flag" }, 403);
    }
  } else {
    if (!organizer.isLeader && body?.eventGroup === "ORGANIZER") {
      return c.json({ message: "Only organizer leader can assign organizer role" }, 403);
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
    where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER" },
  });
  if (!organizer) return c.json({ message: "Forbidden" }, 403);
  const existing = await prisma.eventParticipant.findFirst({ where: { id: pid, eventId: id } });
  if (!existing) return c.json({ message: "Participant not found" }, 404);
  if (existing.eventGroup === "ORGANIZER") {
    if (!organizer.isLeader) return c.json({ message: "Only organizer leader can delete organizer" }, 403);
    if (existing.userId === user.id) {
      return c.json({ message: "Organizer leader cannot delete self" }, 403);
    }
  }
  await prisma.eventParticipant.delete({ where: { id: pid } });
  return c.json({ message: "ok" });
});
eventsRoute.get("/me/drafts", async (c) => {
  const user = c.get("user");
  const drafts = await prisma.event.findMany({
    where: {
      status: "DRAFT",
      participants: { some: { userId: user.id, eventGroup: "ORGANIZER", isLeader: true } },
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
    data: { eventId: event.id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true },
  });
  return c.json({ message: "ok", event });
});

eventsRoute.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const organizer = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER" },
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

  const sv = ("startView" in data ? (data as any).startView : event.startView) as Date | null;
  const ev = ("endView" in data ? (data as any).endView : event.endView) as Date | null;
  if (sv && ev && sv > ev) return c.json({ message: "View period invalid: start after end" }, 400);
  const sj = ("startJoinDate" in data ? (data as any).startJoinDate : event.startJoinDate) as Date | null;
  const ej = ("endJoinDate" in data ? (data as any).endJoinDate : event.endJoinDate) as Date | null;
  if (sj && ej && sj > ej) return c.json({ message: "Submit period invalid: start after end" }, 400);
  if (sj && sv && sj >= sv) return c.json({ message: "Submission start must be before event start" }, 400);
  if (ej && sv && ej >= sv) return c.json({ message: "Submission end must be before event start" }, 400);

  const updated = await prisma.event.update({ where: { id }, data });
  return c.json({ message: "ok", event: updated });
});

eventsRoute.put("/:id/public-view", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return c.json({ message: "Event not found" }, 404);
  const leader = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true },
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
    where: { eventId, userId: user.id, eventGroup: "ORGANIZER" },
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
    where: { eventId, userId: user.id, eventGroup: "ORGANIZER" },
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
    where: { eventId, userId: user.id, eventGroup: "ORGANIZER" },
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
    where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true },
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
    where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true },
  });
  if (!leader) return c.json({ message: "Forbidden" }, 403);
  const updated = await prisma.event.update({ where: { id }, data: { status: "PUBLISHED" } });
  return c.json({ message: "ok", event: updated });
});

export default eventsRoute;
