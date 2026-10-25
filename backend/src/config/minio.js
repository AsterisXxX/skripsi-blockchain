import * as Minio from "minio";

export const BUCKET = process.env.MINIO_BUCKET || "medical-referrals";

export const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "127.0.0.1",
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

export async function checkMinio() {
  return minioClient.bucketExists(BUCKET);
}
