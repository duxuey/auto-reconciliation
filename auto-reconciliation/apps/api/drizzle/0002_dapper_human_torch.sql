CREATE TABLE "biz_reconciliation_environment" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"env_code" varchar(32) NOT NULL,
	"env_name" varchar(128) NOT NULL,
	"db_host" varchar(128) NOT NULL,
	"db_port" integer DEFAULT 3306 NOT NULL,
	"db_user" varchar(64) NOT NULL,
	"db_password_env_key" varchar(128) DEFAULT 'LEGACY_MYSQL_PASSWORD' NOT NULL,
	"default_database" varchar(64),
	"env_status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"description" text,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_environment_system" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"environment_id" varchar(26) NOT NULL,
	"system_id" varchar(26) NOT NULL,
	"schema_map" jsonb NOT NULL,
	"connection_limit" integer DEFAULT 5 NOT NULL,
	"system_status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_system" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"system_code" varchar(32) NOT NULL,
	"system_name" varchar(128) NOT NULL,
	"system_type" varchar(16) NOT NULL,
	"description" text,
	"system_status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_system_pair" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"pair_code" varchar(64) NOT NULL,
	"pair_name" varchar(128) NOT NULL,
	"left_system_id" varchar(26) NOT NULL,
	"right_system_id" varchar(26) NOT NULL,
	"pair_status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "uq_biz_reconciliation_check_gate";--> statement-breakpoint
ALTER TABLE "biz_reconciliation_check_gate" ADD COLUMN "environment_id" varchar(26);--> statement-breakpoint
ALTER TABLE "biz_reconciliation_check_gate" ADD COLUMN "pair_id" varchar(26);--> statement-breakpoint
ALTER TABLE "biz_reconciliation_check_pack" ADD COLUMN "pair_id" varchar(26);--> statement-breakpoint
ALTER TABLE "biz_reconciliation_check_run" ADD COLUMN "environment_id" varchar(26);--> statement-breakpoint
ALTER TABLE "biz_reconciliation_check_run" ADD COLUMN "pair_id" varchar(26);--> statement-breakpoint
ALTER TABLE "biz_reconciliation_import_batch" ADD COLUMN "environment_id" varchar(26);--> statement-breakpoint
ALTER TABLE "biz_reconciliation_source_dataset" ADD COLUMN "system_id" varchar(26);--> statement-breakpoint
ALTER TABLE "biz_reconciliation_source_dataset" ADD COLUMN "schema_key" varchar(32) DEFAULT 'DEFAULT' NOT NULL;--> statement-breakpoint
ALTER TABLE "biz_reconciliation_staging_record" ADD COLUMN "environment_id" varchar(26);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_environment_code" ON "biz_reconciliation_environment" USING btree ("tenant_id","env_code");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_environment_status" ON "biz_reconciliation_environment" USING btree ("env_status","is_default");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_environment_system" ON "biz_reconciliation_environment_system" USING btree ("tenant_id","environment_id","system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_system_code" ON "biz_reconciliation_system" USING btree ("tenant_id","system_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_system_pair_code" ON "biz_reconciliation_system_pair" USING btree ("tenant_id","pair_code");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_system_pair_systems" ON "biz_reconciliation_system_pair" USING btree ("left_system_id","right_system_id");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_pack_pair" ON "biz_reconciliation_check_pack" USING btree ("pair_id","pack_status");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_run_scope" ON "biz_reconciliation_check_run" USING btree ("environment_id","pair_id","period_end_date");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_import_batch_environment" ON "biz_reconciliation_import_batch" USING btree ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_staging_record_environment" ON "biz_reconciliation_staging_record" USING btree ("environment_id","dataset_code","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_check_gate" ON "biz_reconciliation_check_gate" USING btree ("tenant_id","check_stage","environment_id","pair_id","period_start_date","period_end_date");