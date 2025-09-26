import type { User } from "@prisma/client";
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.js";
import { prisma } from "../lib/prisma.js";
import { getMinio } from "../lib/minio.js";

const userRoute = new Hono<{ Variables: { user: User } }>();

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

  const updateData: any = {};
  if (form["username"]) updateData.username = form["username"];
  if (form["name"]) updateData.name = form["name"];
  if (form["description"]) updateData.description = form["description"];

  const file = form["file"] as File | undefined;
  if (file) {
    const bucket = "user-avatars";
    const exists = await minio.bucketExists(bucket).catch(() => false);
    if (!exists) await minio.makeBucket(bucket, "us-east-1");

    const objectName = `${user.id}-${Date.now()}-${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await minio.putObject(bucket, objectName, buffer);

    updateData.image = `${process.env.MINIO_PUBLIC_URL}/${bucket}/${objectName}`;
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  });

  return c.json({ message: "ok", user: updatedUser });
});

export default userRoute;
