import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getMinio } from "../lib/minio.js";
import { uploadFileSchema } from "../lib/types.js";
import sharp from "sharp";

const uploadRoute = new Hono();

uploadRoute.post("/", zValidator("form", uploadFileSchema), async (c) => {
  const { file } = c.req.valid("form");

  if (!file || !(file instanceof File)) {
    return c.json({ message: "No file uploaded" }, 400);
  }

  const minio = getMinio();
  const bucketName = process.env.OBJ_BUCKET!;
  let objectName = `uploads/${Date.now()}-${file.name}`;

  let buffer: Buffer = Buffer.from(await file.arrayBuffer());

  // Convert HEIC to JPEG
  if (
    file.name.toLowerCase().endsWith(".heic") ||
    file.type === "image/heic" ||
    file.type === "image/heif"
  ) {
    try {
      buffer = await sharp(buffer).toFormat("jpeg").toBuffer();
      objectName = objectName.replace(/\.heic$/i, ".jpg");
    } catch (error) {
      console.error("Error converting HEIC to JPEG:", error);
      return c.json({ message: "Error converting HEIC image" }, 500);
    }
  }

  await minio.putObject(bucketName, objectName, buffer);

  return c.json({
    message: "ok",
    url: `/backend/files/${bucketName}/${objectName}`,
  });
});
