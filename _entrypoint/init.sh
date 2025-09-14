#!/bin/bash
set -e

echo "---------------------------------------------"
echo "Setting up PostgreSQL database: $POSTGRES_DB"
echo "Creating application user: $POSTGRES_APP_USER"
echo "---------------------------------------------"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- ตัดสิทธิ์ public ออก (ไม่ให้ทุก user ใช้ schema ได้)
    REVOKE CONNECT ON DATABASE $POSTGRES_DB FROM PUBLIC;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;

    -- สร้าง user ใหม่ (ถ้ามีอยู่แล้ว migration จะ fail ทันที)
    CREATE USER $POSTGRES_APP_USER WITH PASSWORD '$POSTGRES_APP_PASSWORD';

    -- ให้สิทธิ์ connect database
    GRANT CONNECT ON DATABASE $POSTGRES_DB TO $POSTGRES_APP_USER;

    -- ให้สิทธิ์ใช้ schema แต่ห้าม CREATE/ALTER/DROP
    GRANT USAGE ON SCHEMA public TO $POSTGRES_APP_USER;

    -- ให้สิทธิ์ CRUD บนตารางที่มีอยู่แล้วทั้งหมด
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $POSTGRES_APP_USER;

    -- ให้สิทธิ์ใช้ sequence (เวลา insert id auto increment)
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO $POSTGRES_APP_USER;

    -- ให้ default privileges สำหรับตารางใหม่ที่สร้างขึ้นทีหลัง
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $POSTGRES_APP_USER;

    -- ให้ default privileges สำหรับ sequence ใหม่
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO $POSTGRES_APP_USER;
EOSQL
