CREATE TABLE `boostcamp_calendar_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_url` text NOT NULL,
	`events_json` text DEFAULT '[]' NOT NULL,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
