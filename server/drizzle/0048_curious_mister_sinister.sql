DROP INDEX "arsde_signal_terminal_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "arsde_signal_terminal_uq" ON "audience_research_signal_decision_events" USING btree ("account_id","signal_id");