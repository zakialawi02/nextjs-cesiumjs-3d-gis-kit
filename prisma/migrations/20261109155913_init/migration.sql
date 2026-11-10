-- PostGIS: vector layers are stored as PostGIS geometry in dynamic tables.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Dynamic per-layer vector tables (vector_<layer id>) live in their own schema so Prisma never sees them.
CREATE SCHEMA IF NOT EXISTS geodata_vectors;

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMP(3),
    "password" TEXT,
    "profile_photo_path" VARCHAR(2048) NOT NULL DEFAULT '/assets/img/profile/user.png',
    "role" VARCHAR(20) NOT NULL DEFAULT 'engineering',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "source_files" (
    "id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "stored_name" TEXT NOT NULL,
    "file_type" VARCHAR(20) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'uploading',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_jobs" (
    "id" TEXT NOT NULL,
    "layer_type" VARCHAR(20) NOT NULL,
    "source_file_id" TEXT NOT NULL,
    "ortho_file_id" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "conversion_tool" VARCHAR(50),
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_logs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "attempt" SMALLINT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "exit_code" INTEGER,
    "stdout_log" TEXT,
    "stderr_log" TEXT,
    "output_size" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layer_categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "color" VARCHAR(9) NOT NULL DEFAULT '#888888',
    "icon_path" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layer_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layers" (
    "id" TEXT NOT NULL,
    "user_id" UUID,
    "job_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "layer_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "layer_category_id" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terrain_details" (
    "id" TEXT NOT NULL,
    "layer_id" TEXT NOT NULL,
    "source_file_id" TEXT NOT NULL,
    "ortho_file_id" TEXT,
    "has_ortho" BOOLEAN NOT NULL DEFAULT false,
    "ortho_tiles_path" TEXT,
    "ortho_min_zoom" INTEGER,
    "ortho_max_zoom" INTEGER,
    "native_bounding_box" JSONB,
    "srs" VARCHAR(50),
    "output_type" VARCHAR(20) NOT NULL DEFAULT 'terrain',
    "tileset_path" TEXT,
    "tileset_url" TEXT,
    "acquisition_date" DATE,

    CONSTRAINT "terrain_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vector_details" (
    "id" TEXT NOT NULL,
    "layer_id" TEXT NOT NULL,
    "source_file_id" TEXT NOT NULL,
    "native_bounding_box" JSONB,
    "srs" VARCHAR(50),
    "source_format" VARCHAR(20),
    "source_epsg" VARCHAR(50),
    "geometry_type" VARCHAR(30),
    "feature_count" INTEGER NOT NULL DEFAULT 0,
    "acquisition_date" DATE,
    "physical_table_name" TEXT,
    "output_type" VARCHAR(20) NOT NULL DEFAULT 'geojson',
    "output_path" TEXT,

    CONSTRAINT "vector_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "chunk_size" INTEGER NOT NULL,
    "total_chunks" INTEGER NOT NULL,
    "chunks" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'uploading',
    "source_file_id" TEXT,
    "conversion_job_id" TEXT,
    "completion_hash" VARCHAR(64),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE INDEX "conversion_jobs_status_idx" ON "conversion_jobs"("status");

-- CreateIndex
CREATE INDEX "conversion_logs_job_id_attempt_idx" ON "conversion_logs"("job_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "layer_categories_slug_key" ON "layer_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "layers_job_id_key" ON "layers"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "layers_slug_key" ON "layers"("slug");

-- CreateIndex
CREATE INDEX "layers_user_id_idx" ON "layers"("user_id");

-- CreateIndex
CREATE INDEX "layers_status_idx" ON "layers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "terrain_details_layer_id_key" ON "terrain_details"("layer_id");

-- CreateIndex
CREATE UNIQUE INDEX "vector_details_layer_id_key" ON "vector_details"("layer_id");

-- CreateIndex
CREATE INDEX "upload_sessions_user_id_status_idx" ON "upload_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "upload_sessions_expires_at_idx" ON "upload_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_user_id_request_id_key" ON "upload_sessions"("user_id", "request_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_jobs" ADD CONSTRAINT "conversion_jobs_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_jobs" ADD CONSTRAINT "conversion_jobs_ortho_file_id_fkey" FOREIGN KEY ("ortho_file_id") REFERENCES "source_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_logs" ADD CONSTRAINT "conversion_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "conversion_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "conversion_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layers" ADD CONSTRAINT "layers_layer_category_id_fkey" FOREIGN KEY ("layer_category_id") REFERENCES "layer_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terrain_details" ADD CONSTRAINT "terrain_details_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terrain_details" ADD CONSTRAINT "terrain_details_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terrain_details" ADD CONSTRAINT "terrain_details_ortho_file_id_fkey" FOREIGN KEY ("ortho_file_id") REFERENCES "source_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vector_details" ADD CONSTRAINT "vector_details_layer_id_fkey" FOREIGN KEY ("layer_id") REFERENCES "layers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vector_details" ADD CONSTRAINT "vector_details_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "source_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_conversion_job_id_fkey" FOREIGN KEY ("conversion_job_id") REFERENCES "conversion_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
