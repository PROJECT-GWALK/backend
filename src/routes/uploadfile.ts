import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getMinio } from "../lib/minio.js";
import { uploadFileSchema } from "../lib/types.js";

const uploadRoute = new Hono();

uploadRoute.post("/", zValidator("form", uploadFileSchema), async (c) => {
  const { file } = c.req.valid("form");

  if (!file || !(file instanceof File)) {
    return c.json({ message: "No file uploaded" }, 400);
  }

  const minio = getMinio();
  const bucketName = process.env.OBJ_BUCKET!;
  const objectName = `uploads/${Date.now()}-${file.name}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await minio.putObject(bucketName, objectName, buffer);

  return c.json({
    message: "ok",
    url: `/backend/files/${bucketName}/${objectName}`, 
  });
});
