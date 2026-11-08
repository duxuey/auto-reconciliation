CREATE TABLE "biz_reconciliation_automation_config" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"run_time" varchar(5) DEFAULT '08:30' NOT NULL,
	"notify_channel" varchar(16) DEFAULT 'WEBHOOK' NOT NULL,
	"environment_id" varchar(26) NOT NULL,
	"webhook_url_env_key" varchar(128) DEFAULT 'WECOM_WEBHOOK_URL' NOT NULL,
	"app_corp_id" varchar(128),
	"app_agent_id" varchar(64),
	"app_secret_env_key" varchar(128) DEFAULT 'WECOM_APP_SECRET' NOT NULL,
	"to_user" varchar(1024),
	"tenant_id" varchar(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(64) NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "biz_reconciliation_automation_run" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"run_key" varchar(128) NOT NULL,
	"trigger_type" varchar(16) NOT NULL,
	"business_date" date NOT NULL,
	"period_start_date" date NOT NULL,
	"period_end_date" date NOT NULL,
	"environment_id" varchar(26),
	"run_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"pair_count" integer DEFAULT 0 NOT NULL,
	"pair_executed_count" integer DEFAULT 0 NOT NULL,
	"pair_no_data_count" integer DEFAULT 0 NOT NULL,
	"pair_failed_count" integer DEFAULT 0 NOT NULL,
	"batch_count" integer DEFAULT 0 NOT NULL,
	"batch_reused_count" integer DEFAULT 0 NOT NULL,
	"batch_succeeded_count" integer DEFAULT 0 NOT NULL,
	"batch_failed_count" integer DEFAULT 0 NOT NULL,
	"metric_total" integer DEFAULT 0 NOT NULL,
	"fail_metric_count" integer DEFAULT 0 NOT NULL,
	"diff_count" integer DEFAULT 0 NOT NULL,
	"notify_enabled" boolean DEFAULT true NOT NULL,
	"notify_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"notify_channel" varchar(16),
	"notify_error" varchar(512),
	"summary_ext" jsonb,
	"message_text" text,
	"error_message" varchar(512),
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
CREATE UNIQUE INDEX "uq_biz_reconciliation_automation_config_tenant" ON "biz_reconciliation_automation_config" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_biz_reconciliation_automation_run_key" ON "biz_reconciliation_automation_run" USING btree ("tenant_id","run_key");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_automation_run_created" ON "biz_reconciliation_automation_run" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_automation_run_status" ON "biz_reconciliation_automation_run" USING btree ("run_status");--> statement-breakpoint
CREATE INDEX "idx_biz_reconciliation_automation_run_period" ON "biz_reconciliation_automation_run" USING btree ("period_start_date","period_end_date");