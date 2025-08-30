# Instruction Templates

This directory holds canonical minimal template examples copied into production deployments.
Only files under `_templates/` are treated as **templates**; other JSON files in `instructions/` are runtime or seeded entries.

Deployment rules (deploy-local.ps1):

- Overwrite preserves existing `instructions/` directory unless `-EmptyIndex` or `-ForceSeed` used.
- Backup excludes `_templates/` JSON files when creating runtime backups.
- `-EmptyIndex` removes runtime JSON (non-template) but keeps template samples.

Add future template examples here (e.g., `instruction.template.example.json`).
