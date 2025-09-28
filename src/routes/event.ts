import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { getMinio } from "../lib/minio.js";
import { authMiddleware } from "../middlewares/auth.js";
import type { User } from "@prisma/client";

const eventRoute = new Hono<{ Variables: { user: User } }>();

eventRoute.use("*", authMiddleware);

// ✅ Step 1: Create Event (Basic Info) frontend(/createEvent) สำหรับสร้างครั้งแรก
eventRoute.post("/", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();

  const eventName = form["eventName"] as string;
  const eventDescription = form["eventDescription"] as string | undefined;
  const locationName = form["locationName"] as string | undefined;
  const location = form["location"] as string | undefined;
  const imageCover = form["imageCover"] as File | undefined;

  if (!eventName) {
    return c.json({ message: "Event name is required" }, 400);
  }

  let imageCoverUrl: string | null = null;
  if (imageCover) {
    const minio = getMinio();
    const bucket = process.env.OBJ_BUCKET!;
    const objectName = `event-covers/${Date.now()}-${imageCover.name}`;
    const buffer = Buffer.from(await imageCover.arrayBuffer());

    await minio.putObject(bucket, objectName, buffer);
    imageCoverUrl = `/backend/files/${bucket}/${objectName}`;
  }

  const newEvent = await prisma.event.create({
    data: {
      eventName,
      eventDescription: eventDescription ?? null,
      locationName: locationName ?? null,
      location: location ?? null,
      imageCover: imageCoverUrl,
      status: "DRAFT",
      currentStep: 1,
    },
  });

  await prisma.eventParticipant.create({
    data: {
      eventId: newEvent.id,
      userId: user.id,
      eventGroup: "ORGANIZER",
      isLeader: true,
    },
  });

  return c.json({ message: "ok", event: newEvent });
});

// ✅ Step 1: Create Event (Basic Info) frontend(/createEvent/[id]) สำหรับย้อนกลับมาแก้ไข
eventRoute.put("/:id", async (c) => {
  const form = await c.req.parseBody();

  const eventName = form["eventName"] as string;
  const eventDescription = form["eventDescription"] as string | undefined;
  const locationName = form["locationName"] as string | undefined;
  const location = form["location"] as string | undefined;
  const imageCover = form["imageCover"] as File | undefined;

  if (!eventName) {
    return c.json({ message: "Event name is required" }, 400);
  }

  let imageCoverUrl: string | null = null;
  const file = imageCover;
  if (file) {
    const minio = getMinio();
    const bucket = process.env.OBJ_BUCKET!;
    const objectName = `event-covers/${Date.now()}-${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await minio.putObject(bucket, objectName, buffer);
    imageCoverUrl = `/backend/files/${bucket}/${objectName}`;
  }

  const eventId = c.req.param("id");
  const event = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!event) {
    return c.json({ message: "Event not found" }, 404);
  }

  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: {
      eventName,
      eventDescription,
      locationName,
      location,
      imageCover: imageCoverUrl,
      status: "DRAFT",
      currentStep: 1,
    },
  });

  return c.json({ message: "ok", event: updatedEvent });
});

// ✅ Step 2: Participation Settings
eventRoute.put("/:id/participation", async (c) => {
  const eventId = c.req.param("id");
  const body = await c.req.json();

  const {
    publicJoin, // default true
    passwordJoin, // default null
    maxTeams, // default null
    maxTeamMembers, // default null
    publicView, // default true
    passwordView, // default null
    showDashboard, // default true
    fileTypes, // default []
  } = body;

  if (passwordJoin && passwordJoin.length < 6) {
    return c.json(
      { message: "Password must be at least 6 characters long" },
      400
    );
  }
  if (passwordView && passwordView.length < 6) {
    return c.json(
      { message: "Password must be at least 6 characters long" },
      400
    );
  }
  if (!publicJoin && !passwordJoin) {
    return c.json(
      { message: "At least one of public join or password join must be true" },
      400
    );
  }
  if (!publicView && !passwordView) {
    return c.json(
      { message: "At least one of public view or password view must be true" },
      400
    );
  }

  try {
    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        publicJoin,
        passwordJoin,
        maxTeams,
        maxTeamMembers,
        publicView,
        passwordView,
        showDashboard,
        currentStep: 2,
      },
    });

    if (Array.isArray(fileTypes)) {
      await prisma.eventFileType.deleteMany({
        where: { eventId },
      });

      if (fileTypes.length > 0) {
        await prisma.eventFileType.createMany({
          data: fileTypes.map((f: any) => ({
            eventId,
            name: f.name,
            description: f.description ?? null,
            allowedFileType: f.allowedFileType ?? null,
            isRequired: f.isRequired ?? false,
          })),
        });
      }
    }

    const eventWithFileTypes = await prisma.event.findUnique({
      where: { id: eventId },
      include: { fileTypes: true },
    });

    return c.json({ message: "ok", event: eventWithFileTypes });
  } catch (err) {
    console.error("Update Participation error:", err);
    return c.json({ message: "error updating participation" }, 500);
  }
});

// ✅ Step 3: Committee Settings + Guest Reward
eventRoute.put("/:id/committeeguest", async (c) => {
  const eventId = c.req.param("id");
  const body = await c.req.json();

  const {
    hasCommittee = false, // default false
    virtualRewardCommittee = 0, // default 0
    virtualRewardGuest = 0, // default 0
    unitReward = null, // default null
  } = body;

  // ✅ validation
  if (hasCommittee && virtualRewardCommittee < 0) {
    return c.json(
      { message: "Virtual reward for committee must be non-negative" },
      400
    );
  }

  if (virtualRewardGuest < 0) {
    return c.json(
      { message: "Virtual reward for guest must be non-negative" },
      400
    );
  }

  if (
    unitReward &&
    (typeof unitReward !== "string" || unitReward.trim().length < 1)
  ) {
    return c.json({ message: "Unit reward must be a non-empty string" }, 400);
  }

  try {
    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        hasCommittee,
        virtualRewardCommittee,
        virtualRewardGuest,
        unitReward,
        currentStep: 3,
      },
    });

    return c.json({ message: "ok", event: updatedEvent });
  } catch (err) {
    console.error("Update Committee+Guest error:", err);
    return c.json({ message: "error updating committee/guest" }, 500);
  }
});

// ✅ Step 4: Bulk update special rewards (pure multipart, no JSON)
eventRoute.put("/:id/specialreward", async (c) => {
  const eventId = c.req.param("id");
  const form = await c.req.parseBody();

  // ✅ parse rewards จาก form-data
  const rewards: {
    name: string;
    description?: string | null;
    file?: File;
  }[] = [];

  for (const key in form) {
    const match = key.match(/^rewards\[(\d+)\]\[(.+)\]$/);
    if (!match) continue;
    const index = parseInt(match[1], 10);
    const field = match[2];

    if (!rewards[index]) rewards[index] = { name: "" };

    if (field === "name") {
      rewards[index].name = form[key] as string;
    } else if (field === "description") {
      rewards[index].description = form[key] as string;
    } else if (field === "file" && form[key] instanceof File) {
      rewards[index].file = form[key] as File;
    }
  }

  if (rewards.length === 0) {
    return c.json({ message: "No rewards provided" }, 400);
  }

  // ✅ ลบ rewards เก่าของ event
  await prisma.specialReward.deleteMany({ where: { eventId } });

  // ✅ เตรียม MinIO
  const minio = getMinio();
  const bucket = process.env.OBJ_BUCKET!;
  const rewardData = [];

  for (const reward of rewards) {
    let imageUrl: string | null = null;

    if (reward.file) {
      const objectName = `special-rewards/${Date.now()}-${reward.file.name}`;
      const buffer = Buffer.from(await reward.file.arrayBuffer());
      await minio.putObject(bucket, objectName, buffer);
      imageUrl = `/backend/files/${bucket}/${objectName}`;
    }

    rewardData.push({
      eventId,
      name: reward.name,
      description: reward.description ?? null,
      image: imageUrl,
    });
  }

  // ✅ บันทึกใหม่
  if (rewardData.length > 0) {
    await prisma.specialReward.createMany({ data: rewardData });
  }

  // ✅ อัพเดต currentStep
  const updatedEvent = await prisma.event.update({
    where: { id: eventId },
    data: { currentStep: 4 },
    include: { specialRewards: true },
  });

  return c.json({ message: "ok", event: updatedEvent });
});

// ✅ Step 4: List rewards of event
eventRoute.get("/:id/specialreward", async (c) => {
  const eventId = c.req.param("id");

  try {
    const rewards = await prisma.specialReward.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
    });

    return c.json({ message: "ok", rewards });
  } catch (err) {
    console.error("Get SpecialRewards error:", err);
    return c.json({ message: "error fetching special rewards" }, 500);
  }
});

// ✅ Step 4: Delete reward
eventRoute.delete("/specialreward/:rewardId", async (c) => {
  const rewardId = c.req.param("rewardId");

  try {
    await prisma.specialReward.delete({ where: { id: rewardId } });
    return c.json({ message: "ok", deletedId: rewardId });
  } catch (err) {
    console.error("Delete SpecialReward error:", err);
    return c.json({ message: "error deleting special reward" }, 500);
  }
});

// ✅ Step 5: เวลา (Timeline & Dates)
eventRoute.put("/:id/timeline", async (c) => {
  const eventId = c.req.param("id");
  const body = await c.req.json();

  const {
    startJoinDate,
    endJoinDate,
    startView,
    showDashboard,
  } = body;

  try {
    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        startJoinDate: startJoinDate ? new Date(startJoinDate) : null,
        endJoinDate: endJoinDate ? new Date(endJoinDate) : null,
        startView: startView ? new Date(startView) : null,
        showDashboard: !!showDashboard,
        currentStep: 5,
      },
    });

    return c.json({ message: "ok", event: updatedEvent });
  } catch (err) {
    console.error("Update Timeline error:", err);
    return c.json({ message: "error updating timeline" }, 500);
  }
});

// ✅ Step 6: ตรวจสอบและยืนยัน (Preview & Confirm)
eventRoute.get("/:id/preview", async (c) => {
  const eventId = c.req.param("id");

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        fileTypes: true,       // จาก Step 2
        specialRewards: true,  // จาก Step 4
        participants: {
          include: { user: true }, // organizer, committee, etc.
        },
      },
    });

    if (!event) {
      return c.json({ message: "Event not found" }, 404);
    }

    return c.json({ message: "ok", event });
  } catch (err) {
    console.error("Preview Event error:", err);
    return c.json({ message: "error fetching event preview" }, 500);
  }
});

// ✅ Step 6: Confirm & Publish
eventRoute.post("/:id/submit", async (c) => {
  const eventId = c.req.param("id");

  try {
    const submitted = await prisma.event.update({
      where: { id: eventId },
      data: {
        status: "PUBLISHED",
        currentStep: 6,
      },
      include: {
        fileTypes: true,
        specialRewards: true,
        participants: true,
      },
    });

    return c.json({ message: "ok", event: submitted });
  } catch (err) {
    console.error("Submit Event error:", err);
    return c.json({ message: "error submitting event" }, 500);
  }
});

// ✅ Get Event (ใช้สำหรับโหลดตอนแก้ไข Step 1–5)
eventRoute.get("/:id", async (c) => {
  const eventId = c.req.param("id");
  const user = c.get("user");

  try {
    // ตรวจสอบว่าผู้ใช้เป็นเจ้าของจริงมั้ย
    const participant = await prisma.eventParticipant.findFirst({
      where: {
        eventId,
        userId: user.id,
        eventGroup: "ORGANIZER",
        isLeader: true,
      },
    });

    if (!participant) {
      return c.json({ message: "Forbidden: You are not the owner of this event" }, 403);
    }

    // ดึง event พร้อมข้อมูลประกอบ
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        fileTypes: true,       // จาก Step 2
        specialRewards: true,  // จาก Step 4
        participants: {
          include: { user: true }, // organizer, committee, etc.
        },
      },
    });

    if (!event) {
      return c.json({ message: "Event not found" }, 404);
    }

    return c.json({ message: "ok", event });
  } catch (err) {
    console.error("Get Event error:", err);
    return c.json({ message: "error fetching event" }, 500);
  }
});

// ✅ Get my draft events (only owner/organizer leader)
eventRoute.get("/me/drafts", async (c) => {
  const user = c.get("user");

  try {
    const drafts = await prisma.event.findMany({
      where: {
        status: "DRAFT",
        participants: {
          some: {
            userId: user.id,
            eventGroup: "ORGANIZER",
            isLeader: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        eventName: true,
        currentStep: true,
        createdAt: true,
      },
    });

    return c.json({ message: "ok", events: drafts });
  } catch (err) {
    console.error("Get Draft Events error:", err);
    return c.json({ message: "error fetching draft events" }, 500);
  }
});

export default eventRoute;
