import { Hono } from "hono";
import { getMinio } from "../lib/minio.js";
import { nanoid } from "nanoid";

const uploadRoute = new Hono();

uploadRoute.post("/", async (c) => {
  const formData = await c.req.parseBody();
  const file = formData["file"] as File;

  if (!file) {
    return c.json({ message: "No file uploaded" }, 400);
  }

  const minio = getMinio();
  const bucketName = "uploads";

  // สร้าง bucket ถ้ายังไม่มี
  const exists = await minio.bucketExists(bucketName).catch(() => false);
  if (!exists) {
    await minio.makeBucket(bucketName, "us-east-1");
  }

  const objectName = `${nanoid()}-${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await minio.putObject(bucketName, objectName, buffer);

  const fileUrl = `${process.env.MINIO_PUBLIC_URL}/${bucketName}/${objectName}`;

  return c.json({ message: "ok", url: fileUrl });
});

export default uploadRoute;