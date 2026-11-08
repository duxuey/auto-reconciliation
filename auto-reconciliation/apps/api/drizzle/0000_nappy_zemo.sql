CREATE TABLE "biz_reconciliation_adjustment" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"diff_id" varchar(26) NOT NULL,
	"run_id" varchar(26) NOT NULL,
	"adjustment_no" varchar(32) NOT NULL,
	"adjustment_type" varchar(32) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" text NOT NULL,
	"adjustment_status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_check_diff" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"run_id" varchar(26) NOT NULL,
	"comparison_code" varchar(64) NOT NULL,
	"metric_code" varchar(8) NOT NULL,
	"diff_type" varchar(32) NOT NULL,
	"business_key_text" varchar(512) NOT NULL,
	"business_key_ext" jsonb NOT NULL,
	"field_code" varchar(64),
	"left_value" numeric(19, 4),
	"right_value" numeric(19, 4),
	"diff_value" numeric(19, 4),
	"left_text" varchar(512),
	"right_text" varchar(512),
	"currency" varchar(3),
	"diff_status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"assignee" varchar(64),
	"resolution_type" varchar(32),
	"resolution_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_check_diff_log" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"diff_id" varchar(26) NOT NULL,
	"action" varchar(32) NOT NULL,
	"from_status" varchar(16),
	"to_status" varchar(16),
	"note" text,
	"actor" varchar(64) NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_check_gate" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"check_stage" varchar(32) NOT NULL,
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"gate_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"run_ids_ext" jsonb NOT NULL,
	"blocking_metrics_ext" jsonb NOT NULL,
	"signed_off_at" timestamp with time zone,
	"signed_off_by" varchar(64),
	"version" integer DEFAULT 1 NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_check_metric_result" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"run_id" varchar(26) NOT NULL,
	"comparison_code" varchar(64) NOT NULL,
	"metric_code" varchar(8) NOT NULL,
	"metric_name" varchar(128) NOT NULL,
	"metric_type" varchar(32) NOT NULL,
	"check_result" varchar(8) NOT NULL,
	"total_count" bigint NOT NULL,
	"fail_count" bigint NOT NULL,
	"detail_ext" jsonb,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_check_pack" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"pack_code" varchar(64) NOT NULL,
	"pack_name" varchar(128) NOT NULL,
	"check_stage" varchar(32) NOT NULL,
	"pack_status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"current_version_id" varchar(26),
	"description" text,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_check_pack_version" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"version_no" integer NOT NULL,
	"version_status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"config_json" jsonb NOT NULL,
	"config_hash" varchar(64) NOT NULL,
	"source_scripts" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" varchar(64),
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_check_run" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"run_no" varchar(32) NOT NULL,
	"pack_id" varchar(26) NOT NULL,
	"pack_version_id" varchar(26) NOT NULL,
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"run_mode" varchar(16) NOT NULL,
	"run_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"input_fingerprint" varchar(64) NOT NULL,
	"input_manifest_ext" jsonb NOT NULL,
	"metric_total" integer DEFAULT 0 NOT NULL,
	"fail_metric_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"failure_code" varchar(64),
	"failure_message" varchar(512),
	"job_id" varchar(26),
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_import_batch" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"dataset_code" varchar(64) NOT NULL,
	"transport" varchar(16) NOT NULL,
	"file_name" varchar(256),
	"file_hash" varchar(64),
	"mapping_hash" varchar(64) NOT NULL,
	"sync_key" varchar(128),
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"row_total" integer DEFAULT 0 NOT NULL,
	"row_loaded" integer DEFAULT 0 NOT NULL,
	"row_rejected" integer DEFAULT 0 NOT NULL,
	"import_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"job_id" varchar(26),
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_import_row_error" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"import_batch_id" varchar(26) NOT NULL,
	"row_no" integer NOT NULL,
	"error_code" varchar(64) NOT NULL,
	"error_message" varchar(512) NOT NULL,
	"raw_ext" jsonb,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_job" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"job_type" varchar(16) NOT NULL,
	"job_status" varchar(16) DEFAULT 'QUEUED' NOT NULL,
	"ref_type" varchar(32),
	"ref_id" varchar(64),
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"result_ext" jsonb,
	"error_code" varchar(64),
	"error_message" varchar(512),
	"idempotency_key" varchar(128) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_source_dataset" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"dataset_code" varchar(64) NOT NULL,
	"dataset_name" varchar(128) NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"source_schema" varchar(64),
	"transport" varchar(16) NOT NULL,
	"extract_profile" varchar(64),
	"mapping_json" jsonb NOT NULL,
	"mapping_hash" varchar(64) NOT NULL,
	"dataset_status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_staging_record" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"dataset_code" varchar(64) NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"period_code" varchar(8),
	"business_key_text" varchar(512) NOT NULL,
	"business_key_ext" jsonb NOT NULL,
	"amounts_ext" jsonb NOT NULL,
	"currency" varchar(3),
	"business_date" date,
	"record_status" varchar(32),
	"source_payload_ext" jsonb,
	"import_batch_id" varchar(26) NOT NULL,
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_adjustment_no" ON "biz_reconciliation_adjustment" USING btree ("tenant_id","adjustment_no");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_adjustment_diff" ON "biz_reconciliation_adjustment" USING btree ("diff_id");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_adjustment_status" ON "biz_reconciliation_adjustment" USING btree ("adjustment_status");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_diff_run" ON "biz_reconciliation_check_diff" USING btree ("run_id","metric_code");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_diff_status" ON "biz_reconciliation_check_diff" USING btree ("tenant_id","diff_status","created_at");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_diff_key" ON "biz_reconciliation_check_diff" USING btree ("tenant_id","business_key_text");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_diff_log" ON "biz_reconciliation_check_diff_log" USING btree ("diff_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_check_gate" ON "biz_reconciliation_check_gate" USING btree ("tenant_id","check_stage","period_start_date","period_end_date");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_gate_status" ON "biz_reconciliation_check_gate" USING btree ("gate_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_check_metric_result" ON "biz_reconciliation_check_metric_result" USING btree ("run_id","comparison_code","metric_code");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_metric_result_code" ON "biz_reconciliation_check_metric_result" USING btree ("run_id","metric_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_check_pack_code" ON "biz_reconciliation_check_pack" USING btree ("tenant_id","pack_code");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_pack_stage" ON "biz_reconciliation_check_pack" USING btree ("check_stage","pack_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_check_pack_version" ON "biz_reconciliation_check_pack_version" USING btree ("pack_id","version_no");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_pack_version_status" ON "biz_reconciliation_check_pack_version" USING btree ("pack_id","version_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_check_run_no" ON "biz_reconciliation_check_run" USING btree ("tenant_id","run_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_check_run_fingerprint" ON "biz_reconciliation_check_run" USING btree ("tenant_id","input_fingerprint");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_run_pack" ON "biz_reconciliation_check_run" USING btree ("pack_id","period_end_date");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_check_run_status" ON "biz_reconciliation_check_run" USING btree ("run_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_import_batch_file" ON "biz_reconciliation_import_batch" USING btree ("tenant_id","dataset_code","file_hash","mapping_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_import_batch_sync" ON "biz_reconciliation_import_batch" USING btree ("tenant_id","sync_key");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_import_batch_dataset" ON "biz_reconciliation_import_batch" USING btree ("dataset_code","created_at");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_import_row_error_batch" ON "biz_reconciliation_import_row_error" USING btree ("import_batch_id","row_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_job_idempotency" ON "biz_reconciliation_job" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_job_status" ON "biz_reconciliation_job" USING btree ("job_status");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_job_ref" ON "biz_reconciliation_job" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_source_dataset" ON "biz_reconciliation_source_dataset" USING btree ("tenant_id","dataset_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_staging_record" ON "biz_reconciliation_staging_record" USING btree ("tenant_id","dataset_code","external_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_staging_record_key" ON "biz_reconciliation_staging_record" USING btree ("tenant_id","business_key_text");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_staging_record_period" ON "biz_reconciliation_staging_record" USING btree ("dataset_code","business_date");