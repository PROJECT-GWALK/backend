import * as Minio from "minio";

const minio = new Minio.Client({
  endPoint: process.env.OBJ_STORAGE_ADDR as string,
  port: Number(process.env.OBJ_STORAGE_PORT),
  useSSL: process.env.OBJ_STORAGE_SSL === "true",
  accessKey: process.env.OBJ_ACCESS_KEY as string,
  secretKey: process.env.OBJ_SECRET_KEY as string,

  region: "us-east-1",
  pathStyle: true,
});

export function getMinio() {
  return minio;
}