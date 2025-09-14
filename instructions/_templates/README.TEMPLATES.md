# Instruction Templates

This directory holds canonical minimal template examples copied into production deployments.
Only files under `_templates/` are treated as **templates**; other JSON files in `instructions/` are runtime or seeded entries.

Deployment rules (deploy-local.ps1):

- Overwrite preserves existing `instructions/` directory unless `-EmptyIndex` or `-ForceSeed` used.
- Backup excludes `_templates/` JSON files when creating runtime backups.
- `-EmptyIndex` removes runtime JSON (non-template) but keeps template samples.

Add future template examples here (e.g., `instruction.template.example.json`).

## Schema Version Alignment

Current instruction schemaVersion: `3`.

All template examples have been updated to declare `"schemaVersion": "3"` and at least one template now includes the new `primaryCategory` field (and ensures it is a member of `categories`). When adding a new template:

- Set `schemaVersion` to the current version (check `schemas/instruction.schema.json`).
- If you provide `primaryCategory`, it MUST also appear in the `categories` array.
- Prefer including `primaryCategory` in at least one template whenever the schema introduces new fields so coverage tests remain meaningful.

The `enrich_placeholder_sample.json` intentionally leaves certain governance and timestamp fields blank; the template coverage test allows these blanks for enrichment scenarios.
