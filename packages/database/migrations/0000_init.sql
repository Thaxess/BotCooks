CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"created_by" text NOT NULL,
	"source" text NOT NULL,
	"prompt" text NOT NULL,
	"template_id" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"error" text,
	"interaction_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_counters" (
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guild_counters_guild_id_name_pk" PRIMARY KEY("guild_id","name")
);
--> statement-breakpoint
CREATE TABLE "custom_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"graph" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"discord_command_id" text,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_stats" (
	"guild_id" text NOT NULL,
	"day" date NOT NULL,
	"joins" integer DEFAULT 0 NOT NULL,
	"leaves" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"mod_actions" integer DEFAULT 0 NOT NULL,
	"automod_actions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_stats_guild_id_day_pk" PRIMARY KEY("guild_id","day")
);
--> statement-breakpoint
CREATE TABLE "dashboard_delegations" (
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_delegations_guild_id_role_id_pk" PRIMARY KEY("guild_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "event_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"graph" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_ops" (
	"execution_id" uuid NOT NULL,
	"op_id" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_ops_execution_id_op_id_pk" PRIMARY KEY("execution_id","op_id")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"kind" text NOT NULL,
	"plan_version_id" uuid,
	"parent_execution_id" uuid,
	"mode" text DEFAULT 'additive' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"ops" jsonb NOT NULL,
	"snapshot_id" uuid,
	"expected_snapshot_hash" text,
	"initial_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk" jsonb,
	"irreversible" jsonb,
	"confirmed_by" text NOT NULL,
	"confirmation_nonce" text NOT NULL,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"progress_label" text,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "giveaway_entries" (
	"giveaway_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giveaway_entries_giveaway_id_user_id_pk" PRIMARY KEY("giveaway_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "giveaways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"prize" text NOT NULL,
	"winner_count" integer DEFAULT 1 NOT NULL,
	"host_id" text NOT NULL,
	"required_role_id" text,
	"ends_at" timestamp with time zone NOT NULL,
	"ended" boolean DEFAULT false NOT NULL,
	"winners" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_locks" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"owner_id" text NOT NULL,
	"bot_present" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"guild_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "level_members" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"xp" bigint DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"last_xp_at" timestamp with time zone,
	CONSTRAINT "level_members_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mod_cases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"case_number" integer NOT NULL,
	"type" text NOT NULL,
	"user_id" text NOT NULL,
	"moderator_id" text NOT NULL,
	"reason" text,
	"duration_seconds" integer,
	"metadata" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"appeal_status" text DEFAULT 'none' NOT NULL,
	"appeal_text" text,
	"appealed_at" timestamp with time zone,
	"appeal_resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"version" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"raw_plan" jsonb,
	"validation" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"instruction" text,
	"ai_provider" text,
	"ai_model" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_mappings" (
	"execution_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"ref" text NOT NULL,
	"discord_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_mappings_execution_id_ref_pk" PRIMARY KEY("execution_id","ref")
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"content" text,
	"embed" jsonb,
	"interval_minutes" integer,
	"next_run_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_role_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text NOT NULL,
	"title" text NOT NULL,
	"role_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"reason" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"hash" text NOT NULL,
	"settings" jsonb,
	"label" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stream_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"platform" text NOT NULL,
	"account" text NOT NULL,
	"channel_id" text NOT NULL,
	"message" text DEFAULT '{account} is live! {url}' NOT NULL,
	"ping_role_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_state" jsonb,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temp_voice_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"number" integer NOT NULL,
	"thread_id" text,
	"opener_id" text NOT NULL,
	"subject" text,
	"status" text DEFAULT 'open' NOT NULL,
	"claimed_by" text,
	"closed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"global_name" text,
	"avatar" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_ops" ADD CONSTRAINT "execution_ops_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_snapshot_id_guild_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."guild_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_giveaway_id_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_session_id_build_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."build_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_mappings" ADD CONSTRAINT "resource_mappings_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_guild_idx" ON "audit_logs" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "build_sessions_guild_idx" ON "build_sessions" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_commands_name_uq" ON "custom_commands" USING btree ("guild_id","name");--> statement-breakpoint
CREATE INDEX "event_workflows_trigger_idx" ON "event_workflows" USING btree ("guild_id","trigger","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_nonce_uq" ON "executions" USING btree ("confirmation_nonce");--> statement-breakpoint
CREATE INDEX "executions_guild_idx" ON "executions" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "giveaways_due_idx" ON "giveaways" USING btree ("ended","ends_at");--> statement-breakpoint
CREATE INDEX "giveaways_guild_idx" ON "giveaways" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('queued','running');--> statement-breakpoint
CREATE INDEX "level_members_rank_idx" ON "level_members" USING btree ("guild_id","xp");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_cases_number_uq" ON "mod_cases" USING btree ("guild_id","case_number");--> statement-breakpoint
CREATE INDEX "mod_cases_user_idx" ON "mod_cases" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_session_version_uq" ON "plan_versions" USING btree ("session_id","version");--> statement-breakpoint
CREATE INDEX "plan_versions_guild_idx" ON "plan_versions" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_mappings_discord_uq" ON "resource_mappings" USING btree ("execution_id","discord_id");--> statement-breakpoint
CREATE INDEX "scheduled_due_idx" ON "scheduled_messages" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "scheduled_guild_idx" ON "scheduled_messages" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "self_role_panels_message_uq" ON "self_role_panels" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "self_role_panels_guild_idx" ON "self_role_panels" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guild_snapshots_guild_idx" ON "guild_snapshots" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stream_subs_uq" ON "stream_subscriptions" USING btree ("guild_id","platform","account","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_uq" ON "tickets" USING btree ("guild_id","number");--> statement-breakpoint
CREATE INDEX "tickets_opener_idx" ON "tickets" USING btree ("guild_id","opener_id","status");