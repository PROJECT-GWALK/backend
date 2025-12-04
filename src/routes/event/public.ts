import { Hono } from "hono";
import { authMiddleware } from "../../middlewares/auth.js";
import type { User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

const publicRoute = new Hono<{ Variables: { user: User } }>();

publicRoute.use("*", authMiddleware);

publicRoute.get("/me", async (c) => {
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
      participants: { where: { userId: user.id }, select: { eventGroup: true, isLeader: true } },
    },
  });
  const payload = events.map((e) => ({
    id: e.id,
    eventName: e.eventName,
    status: e.status,
    createdAt: e.createdAt,
    imageCover: e.imageCover,
    role: e.participants?.[0]?.eventGroup || null,
    isLeader: e.participants?.[0]?.isLeader || false,
  }));
  return c.json({ message: "ok", events: payload });
});

publicRoute.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  let event;
  if (id) {
    event = await prisma.event.findUnique({
      where: { id },
      include: { fileTypes: true, specialRewards: true, participants: { include: { user: true } } },
    });
  } else {
    event = await prisma.event.findFirst({
      where: { eventName: id },
      include: { fileTypes: true, specialRewards: true, participants: { include: { user: true } } },
    });
  }
  if (!event) {
    return c.json({ message: "Event not found" }, 404);
  }

  if (event.status === "DRAFT") {
    const organizer = await prisma.eventParticipant.findFirst({
      where: { eventId: id, userId: user.id, eventGroup: "ORGANIZER" },
    });
    if (!organizer) {
      return c.json({ message: "Forbidden" }, 403);
    }
    return c.json({ message: "ok", event });
  }

  if (event.publicView) {
    return c.json({ message: "ok", event });
  }

  const participant = await prisma.eventParticipant.findFirst({
    where: { eventId: id, userId: user.id },
  });
  if (!participant) {
    return c.json({ message: "Forbidden" }, 403);
  }

  return c.json({ message: "ok", event });
});

publicRoute.get("/check-name/check", async (c) => {
  const eventName = c.req.query("eventName");
  if (!eventName || typeof eventName !== "string" || eventName.trim().length < 1) {
    return c.json({ message: "eventName is required" }, 400);
  }
  const exists = await prisma.event.findFirst({
    where: { eventName: { equals: eventName.trim(), mode: "insensitive" } },
  });
  return c.json({ message: "ok", available: !exists });
});

export default publicRoute;

