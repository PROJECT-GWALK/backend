import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getMinio } from "../lib/minio.js";
import mime from "mime-types";
import sharp from "sharp";
import { filesParamSchema } from "../lib/types.js";

const filesRoute = new Hono();

filesRoute.get(
  "/:bucket/:object{.+}",
  zValidator("param", filesParamSchema),
  async (c) => {
    const minio = getMinio();
    const { bucket, object: objectName } = c.req.valid("param");

    try {
      const stream = await minio.getObject(bucket, objectName);
      if (!stream) {
        return c.json({ message: "File not found" }, 404);
      }

      // Convert HEIC to JPEG on the fly
      if (objectName.toLowerCase().endsWith(".heic")) {
        const transformer = sharp().toFormat("jpeg");
        const jpegStream = stream.pipe(transformer);
        return c.body(jpegStream as any, 200, {
          "Content-Type": "image/jpeg",
        });
      }

      const contentType = mime.lookup(objectName) || "application/octet-stream";

      return c.body(stream as any, 200, {
        "Content-Type": contentType,
      });
    } catch (err) {
      console.error(err);
      return c.json({ message: "File not found" }, 404);
    }
  }
);

export default filesRoute;
