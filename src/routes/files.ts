import { Hono } from "hono";
import { getMinio } from "../lib/minio.js";
import mime from "mime-types";

const filesRoute = new Hono();

filesRoute.get("/:bucket/:object{.+}", async (c) => {
  const minio = getMinio();
  const bucket = c.req.param("bucket");
  const objectName = c.req.param("object");

  try {
    const stream = await minio.getObject(bucket, objectName);
    if (!stream) {
      return c.json({ message: "File not found" }, 404);
    }

    const contentType = mime.lookup(objectName) || "application/octet-stream";

    return c.body(stream as any, 200, {
      "Content-Type": contentType,
    });
  } catch (err) {
    console.error(err);
    return c.json({ message: "File not found" }, 404);
  }
});

export default filesRoute;
