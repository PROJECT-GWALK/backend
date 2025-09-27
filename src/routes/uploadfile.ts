import { Hono } from "hono";
import { getMinio } from "../lib/minio.js";

const uploadRoute = new Hono();

uploadRoute.post("/", async (c) => {
  const formData = await c.req.parseBody();
  const file = formData["file"] as File;

  if (!file) {
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
