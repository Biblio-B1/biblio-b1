CREATE TABLE `import_exclusions` (
	`sha256` text PRIMARY KEY NOT NULL,
	`source_path` text,
	`deleted_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_by` text
);
