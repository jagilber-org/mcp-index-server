# Security Policy

## Reporting a Vulnerability

Please report suspected vulnerabilities privately.

1. Create a new security advisory (preferred) or email the maintainer.
2. Include reproduction steps, impact assessment, and any logs.
3. Allow up to 5 business days for initial response.

## Supported Versions

Only the latest minor release is actively supported for security fixes.

## Vulnerability Disclosure

We will:

- Confirm the issue and assign a CVE if applicable.
- Prepare a fix and coordinate a release.
- Credit reporters who wish to be acknowledged.

## Hardening Notes

This project includes enterprise hardening (see `HARDENING-DESIGN.md`). Keep auth secrets (`MCP_AUTH_KEY`) private. Avoid committing credentials or tokens.
