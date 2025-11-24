import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { authMiddleware } from "../middlewares/auth.js";
import type { User } from "@prisma/client";
import crypto from "crypto";

const eventRoute = new Hono<{ Variables: { user: User } }>();

eventRoute.use("*", authMiddleware);

eventRoute.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const eventName = body.eventName;
  if (!eventName || typeof eventName !== "string" || eventName.trim().length < 1) {
    return c.json({ message: "Event name is required" }, 400);
  }
  const exists = await prisma.event.findFirst({ where: { eventName } });
  if (exists) {
    return c.json({ message: "Event name already exists" }, 409);
  }
  const event = await prisma.event.create({ data: { eventName, status: "DRAFT" } });
  await prisma.eventParticipant.create({ data: { eventId: event.id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true } });
  return c.json({ message: "ok", event });
});

eventRoute.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) {
    return c.json({ message: "Event not found" }, 404);
  }
  const leader = await prisma.eventParticipant.findFirst({ where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true } });
  if (!leader) {
    return c.json({ message: "Forbidden" }, 403);
  }
  if (body.eventName && body.eventName !== event.eventName) {
    const dup = await prisma.event.findFirst({ where: { eventName: body.eventName } });
    if (dup) {
      return c.json({ message: "Event name already exists" }, 409);
    }
  }
  const updated = await prisma.event.update({
    where: { id },
    data: {
      eventName: body.eventName ?? event.eventName,
      eventDescription: body.eventDescription ?? event.eventDescription,
      locationName: body.locationName ?? event.locationName,
      location: body.location ?? event.location,
    },
  });
  return c.json({ message: "ok", event: updated });
});

eventRoute.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) {
    return c.json({ message: "Event not found" }, 404);
  }
  const leader = await prisma.eventParticipant.findFirst({ where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true } });
  if (!leader) {
    return c.json({ message: "Forbidden" }, 403);
  }
  if (event.status !== "DRAFT") {
    return c.json({ message: "Only draft events can be deleted" }, 400);
  }
  await prisma.event.delete({ where: { id } });
  return c.json({ message: "ok", deletedId: id });
});

eventRoute.post("/:id/organizers/invite", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { email } = await c.req.json();
  const leader = await prisma.eventParticipant.findFirst({ where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true } });
  if (!leader) {
    return c.json({ message: "Forbidden" }, 403);
  }
  if (!email) {
    return c.json({ message: "Email is required" }, 400);
  }
  const target = await prisma.user.findUnique({ where: { email } });
  if (!target) {
    return c.json({ message: "User not found" }, 404);
  }
  const exp = Date.now() + 1000 * 60 * 60 * 24;
  const payload = JSON.stringify({ eventId: id, email, exp });
  const secret = process.env.INVITE_SECRET ?? "invite_secret";
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const token = Buffer.from(payload).toString("base64") + "." + signature;
  const inviteUrl = `/api/events/invites/accept?token=${encodeURIComponent(token)}`;
  return c.json({ message: "ok", inviteUrl });
});

eventRoute.get("/invites/accept", async (c) => {
  const user = c.get("user");
  const token = c.req.query("token");
  if (!token) {
    return c.json({ message: "Invalid token" }, 400);
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    return c.json({ message: "Invalid token" }, 400);
  }
  let payloadStr;
  try {
    payloadStr = Buffer.from(parts[0], "base64").toString();
  } catch {
    return c.json({ message: "Invalid token" }, 400);
  }
  const secret = process.env.INVITE_SECRET ?? "invite_secret";
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");
  if (parts[1] !== expectedSig) {
    return c.json({ message: "Invalid token" }, 400);
  }
  const payload = JSON.parse(payloadStr);
  if (!payload || !payload.eventId || !payload.email || !payload.exp || payload.exp < Date.now()) {
    return c.json({ message: "Invalid or expired token" }, 400);
  }
  if (!user.email || user.email !== payload.email) {
    return c.json({ message: "Forbidden" }, 403);
  }
  const event = await prisma.event.findUnique({ where: { id: payload.eventId } });
  if (!event) {
    return c.json({ message: "Event not found" }, 404);
  }
  const exists = await prisma.eventParticipant.findFirst({ where: { eventId: payload.eventId, userId: user.id, eventGroup: "ORGANIZER" } });
  if (!exists) {
    await prisma.eventParticipant.create({ data: { eventId: payload.eventId, userId: user.id, eventGroup: "ORGANIZER", isLeader: false } });
  }
  return c.json({ message: "ok" });
});

eventRoute.put("/:id/publicview", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const { publicView } = await c.req.json();
  const leader = await prisma.eventParticipant.findFirst({ where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true } });
  if (!leader) {
    return c.json({ message: "Forbidden" }, 403);
  }
  const updated = await prisma.event.update({ where: { id }, data: { publicView: !!publicView } });
  return c.json({ message: "ok", event: updated });
});

eventRoute.post("/:id/submit", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const leader = await prisma.eventParticipant.findFirst({ where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER", isLeader: true } });
  if (!leader) {
    return c.json({ message: "Forbidden" }, 403);
  }
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) {
    return c.json({ message: "Event not found" }, 404);
  }
  if (!event.eventDescription || !event.locationName) {
    return c.json({ message: "Event incomplete" }, 400);
  }
  const submitted = await prisma.event.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publicView: typeof body.publicView === "boolean" ? body.publicView : event.publicView,
    },
  });
  return c.json({ message: "ok", event: submitted });
});

export default eventRoute;