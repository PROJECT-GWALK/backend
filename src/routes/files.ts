import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { getMinio } from "../lib/minio.js";
import mime from "mime-types";
import sharp from "sharp";
import { filesParamSchema } from "../lib/types.js";
import path from "node:path";

const filesRoute = new Hono();

filesRoute.get(
  "/:bucket/:object{.+}",
  zValidator("param", filesParamSchema),
  async (c) => {
    const minio = getMinio();
    const { bucket, object: objectName } = c.req.valid("param");
    const allowedBucket = process.env.OBJ_BUCKET;

    if (!allowedBucket || bucket !== allowedBucket) {
      return c.json({ message: "Forbidden" }, 403);
    }
    if (
      objectName.includes("..") ||
      objectName.includes("\\") ||
      objectName.startsWith("/") ||
      /[\x00-\x1F\x7F]/.test(objectName)
    ) {
      return c.json({ message: "Invalid file path" }, 400);
    }

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
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Frame-Options": "SAMEORIGIN",
        });
      }

      const contentType = mime.lookup(objectName) || "application/octet-stream";

      const baseName = path.basename(objectName);
      const dangerousInlineTypes = new Set([
        "text/html",
        "application/xhtml+xml",
        "image/svg+xml",
        "text/xml",
      ]);
      const shouldForceAttachment = dangerousInlineTypes.has(String(contentType).toLowerCase());

      return c.body(stream as any, 200, {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Disposition": `${shouldForceAttachment ? "attachment" : "inline"}; filename="${baseName}"`,
      });
    } catch (err) {
      console.error(err);
      return c.json({ message: "File not found" }, 404);
    }
  }
);

export default filesRoute;
