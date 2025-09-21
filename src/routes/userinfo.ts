import type { User } from "@prisma/client";
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/auth.js";
import { prisma } from "../lib/prisma.js";

const userRoute = new Hono<{ Variables: { user: User } }>();

userRoute.use("*", authMiddleware);

userRoute.get("/", (c) => {
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

  return c.json({ message: "ok", user: safeUser });
});


userRoute.put("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const updateData: any = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.username !== undefined) updateData.username = body.username;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.image !== undefined) updateData.image = body.image;

  if (updateData.username) {
    const existingUser = await prisma.user.findUnique({
      where: { username: updateData.username },
    });
    if (existingUser && existingUser.id !== user.id) {
      return c.json({ message: "username already taken" }, 409);
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  });

  return c.json({ message: "ok", user: updatedUser });
});

export default userRoute;