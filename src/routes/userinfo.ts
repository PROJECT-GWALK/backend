import type { User } from "@prisma/client";
import { Hono } from "hono";
import { authMiddleware, optionalAuthMiddleware } from "../middlewares/auth.js";
import { prisma } from "../lib/prisma.js";
import { getMinio } from "../lib/minio.js";
import { updateUserProfileSchema } from "../lib/types.js";

export const userRoute = new Hono<{ Variables: { user: User } }>();

userRoute
  .use("*", authMiddleware)

  .get("/", async (c) => {
    const user = c.get("user");

    const safeUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      image: user.image,
      description: user.description,
      role: user.role,
    };

    const ban = await prisma.userBan.findUnique({
      where: { email: user.email! },
    });

    let banned = false;
    let reason: string | null = null;

    if (ban && (!ban.expiresAt || ban.expiresAt > new Date())) {
      banned = true;
      reason = ban.reason || "No reason provided";
    }

    return c.json({ message: "ok", user: safeUser, banned, reason });
  });

userRoute.put("/", async (c) => {
  const user = c.get("user");
  const minio = getMinio();
  const form = await c.req.parseBody();

  const result = updateUserProfileSchema.safeParse(form);
  if (!result.success) {
    return c.json({ message: "Invalid input", errors: result.error }, 400);
  }

  const { username, name, description, image } = result.data;

  const updateData: any = {};
  if (username) updateData.username = username;
  if (name) updateData.name = name;
  if (description) updateData.description = description;
  if (image === "null") {
    updateData.image = null;
  }

  const file = form["file"] as File | undefined;
  if (file) {
    const bucket = process.env.OBJ_BUCKET!;
    const objectName = `user-avatars/${user.id}-${Date.now()}-${file.name}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    await minio.putObject(bucket, objectName, buffer);

    updateData.image = `/backend/files/${bucket}/${objectName}`;
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  });

  return c.json({ message: "ok", user: updatedUser });
});

export const userProfileRoute = new Hono<{ Variables: { user: User | null } }>();

userProfileRoute.use("*", optionalAuthMiddleware);

userProfileRoute.get("/", async (c) => {
  const query = c.req.query("q") || "";
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "12");
  const sort = c.req.query("sort") || "latest"; // latest, most_active
  const skip = (page - 1) * limit;

  const whereClause: any = {};
  
  if (query) {
    whereClause.OR = [
      { name: { contains: query, mode: "insensitive" } },
      { username: { contains: query, mode: "insensitive" } },
    ];
  }

  let orderBy: any = { createdAt: "desc" };
  if (sort === "most_active") {
    orderBy = { participants: { _count: "desc" } };
  } else if (sort === "name") {
    orderBy = { name: "asc" };
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        username: true,
        name: true,
        image: true,
        description: true,
        role: true,
        createdAt: true,
        participants: {
          select: {
            eventGroup: true
          }
        }
      },
      skip,
      take: limit,
      orderBy: orderBy
    }),
    prisma.user.count({ where: whereClause })
  ]);

  const usersWithStats = users.map(user => {
    const organizedCount = user.participants.filter(p => p.eventGroup === "ORGANIZER").length;
    const participatedCount = user.participants.length;
    
    // Remove participants array to save bandwidth
    const { participants, ...rest } = user;
    
    return {
      ...rest,
      stats: {
        organized: organizedCount,
        participated: participatedCount
      }
    };
  });

  return c.json({ 
    message: "ok", 
    users: usersWithStats, 
    meta: {
      total, 
      page, 
      totalPages: Math.ceil(total / limit),
      limit
    }
  });
});

userProfileRoute.get("/:username", async (c) => {
  let username = c.req.param("username");

  if (username.startsWith("@")) {
    username = username.substring(1);
  }

  const user = await prisma.user.findFirst({
    where: { username },
  });

  if (!user) {
    return c.json({ message: "User not found" }, 404);
  }

  const safeUser = {
    id: user.id,
    email: user.email, // Maybe hide email for public?
    username: user.username,
    name: user.name,
    image: user.image,
    description: user.description,
    role: user.role,
  };

  return c.json({ message: "ok", user: safeUser });
});

