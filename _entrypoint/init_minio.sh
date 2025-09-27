#!/bin/sh
set -e

echo "➡️ Running MinIO entrypoint init script..."

# ใช้ค่า env ที่ได้จาก docker-compose
ALIAS_NAME="myminio"
MINIO_ENDPOINT="http://localhost:9000"
BUCKET_NAME="${OBJ_BUCKET:-app-minio}"

# ติดตั้ง mc ถ้าไม่มี (minio image ไม่มี mc)
if ! command -v mc >/dev/null 2>&1; then
  echo "⬇️ Installing mc..."
  curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
  chmod +x /usr/local/bin/mc
fi

# รอ MinIO พร้อมให้บริการ
echo "⏳ Waiting for MinIO server to be ready..."
until mc alias set "${ALIAS_NAME}" "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1; do
  sleep 2
done
echo "✅ MinIO is up"

# เช็คว่ามี bucket หรือยัง
if mc ls "${ALIAS_NAME}" | awk '{print $5}' | grep -q "^${BUCKET_NAME}/$"; then
  echo "✅ Bucket '${BUCKET_NAME}' already exists"
else
  echo "📦 Creating bucket '${BUCKET_NAME}' ..."
  mc mb "${ALIAS_NAME}/${BUCKET_NAME}"
  echo "✅ Bucket '${BUCKET_NAME}' created"
fi

echo "🎉 MinIO bucket init finished."