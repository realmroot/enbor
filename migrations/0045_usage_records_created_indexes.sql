CREATE INDEX `idx_usage_records_created` ON `usage_records` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_usage_records_organization_created` ON `usage_records` (`organization_id`,`created_at`);
