#!/bin/sh
set -e

echo "🔹 [init_minio] Starting MinIO initialization..."

MC_ALIAS="local"
MINIO_ENDPOINT="http://localhost:9000"

# รอให้ MinIO พร้อมก่อน (บางที container ยังไม่ ready)
echo "🔹 [init_minio] Waiting for MinIO to be ready..."
until mc alias set "$MC_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "   MinIO is not ready yet, retry in 2s..."
  sleep 2
done

echo "✅ [init_minio] MinIO is reachable as root user: $MINIO_ROOT_USER"

# 1) สร้าง bucket ถ้ายังไม่มี
if mc ls "$MC_ALIAS/$OBJ_BUCKET" >/dev/null 2>&1; then
  echo "ℹ️  [init_minio] Bucket '$OBJ_BUCKET' already exists, skip creating."
else
  echo "🔹 [init_minio] Creating bucket '$OBJ_BUCKET'..."
  mc mb "$MC_ALIAS/$OBJ_BUCKET"
  echo "✅ [init_minio] Bucket '$OBJ_BUCKET' created."
fi

# 2) สร้าง user ปกติ MINIO_USER ถ้ายังไม่มี
if mc admin user info "$MC_ALIAS" "$MINIO_USER" >/dev/null 2>&1; then
  echo "ℹ️  [init_minio] User '$MINIO_USER' already exists, skip creating."
else
  echo "🔹 [init_minio] Creating user '$MINIO_USER'..."
  mc admin user add "$MC_ALIAS" "$MINIO_USER" "$MINIO_PASSWORD"
  echo "✅ [init_minio] User '$MINIO_USER' created."
fi

# 3) สร้าง policy ให้ user นี้มีสิทธิเต็มใน bucket เดียว OBJ_BUCKET
POLICY_NAME="${OBJ_BUCKET}-full-access"

POLICY_FILE="/tmp/${POLICY_NAME}.json"

cat > "$POLICY_FILE" << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": [
        "s3:ListBucket"
      ],
      "Effect": "Allow",
      "Resource": [
        "arn:aws:s3:::$OBJ_BUCKET"
      ]
    },
    {
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Effect": "Allow",
      "Resource": [
        "arn:aws:s3:::$OBJ_BUCKET/*"
      ]
    }
  ]
}
EOF

# สร้าง policy ถ้ายังไม่มี
if mc admin policy info "$MC_ALIAS" "$POLICY_NAME" >/dev/null 2>&1; then
  echo "ℹ️  [init_minio] Policy '$POLICY_NAME' already exists, skip creating."
else
  echo "🔹 [init_minio] Creating policy '$POLICY_NAME'..."
  mc admin policy create "$MC_ALIAS" "$POLICY_NAME" "$POLICY_FILE"
  echo "✅ [init_minio] Policy '$POLICY_NAME' created."
fi

# 4) ผูก policy เข้ากับ user
echo "🔹 [init_minio] Attaching policy '$POLICY_NAME' to user '$MINIO_USER'..."
mc admin policy attach "$MC_ALIAS" "$POLICY_NAME" --user "$MINIO_USER"
echo "✅ [init_minio] User '$MINIO_USER' now has full access to bucket '$OBJ_BUCKET' only."

echo "🎉 [init_minio] MinIO initialization completed."