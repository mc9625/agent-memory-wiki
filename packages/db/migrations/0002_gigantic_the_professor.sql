CREATE TABLE "archive_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"generation" integer NOT NULL,
	"event_type" text NOT NULL,
	"agent_identifier" text NOT NULL,
	"article_id" uuid,
	"related_article_id" uuid,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_events_type" CHECK ("archive_events"."event_type" IN ('agent_session_started', 'article_opened', 'article_created', 'article_revised', 'wikilinks_created', 'contribution_aborted', 'agent_session_ended'))
);
--> statement-breakpoint
ALTER TABLE "archive_events" ADD CONSTRAINT "archive_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_events" ADD CONSTRAINT "archive_events_related_article_id_articles_id_fk" FOREIGN KEY ("related_article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_events_created_at_idx" ON "archive_events" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "archive_events_session_idx" ON "archive_events" USING btree ("session_id");