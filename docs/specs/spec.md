# MCP Index Server - Product Specification

## Overview

The MCP Index Server is an enterprise-grade instruction indexing platform for AI assistant governance and developer tooling. It provides deterministic management of instruction catalogs with tamper detection, audit trails, and comprehensive observability.

**Core Value Proposition**: Transform directories of JSON instructions into a versioned, queryable knowledge plane with integrity guarantees and sub-120ms latency at scale.

## User Scenarios

### Priority 1: Mission-Critical Functionality

#### US-001: Deterministic Instruction Catalog Management [P1]
**As a** governance engineer managing AI assistant prompts  
**I want** deterministic hashing and tamper detection for instruction catalogs  
**So that** I can ensure prompt integrity and detect unauthorized modifications

**Acceptance Criteria:**
- **Given** a directory containing JSON instruction files
- **When** the MCP Index Server loads the catalog
- **Then** each instruction receives a deterministic source hash
- **And** governance hash computation is reproducible across reloads

**Success Criteria:**
- **SC-001**: <0.1% unintended hash drift per release
- **SC-002**: Hash stability verification passes 100 consecutive tests
- **SC-003**: Catalog load completes in <5 seconds for 10,000 instructions

#### US-002: Schema Migration with Zero Downtime [P1]
**As a** platform engineer upgrading instruction schemas  
**I want** idempotent schema migrations without service interruption  
**So that** I can evolve the system safely without blocking operations

**Acceptance Criteria:**
- **Given** instructions in schema v2 format
- **When** migration to schema v3 executes
- **Then** all fields migrate correctly with primaryCategory invariant
- **And** migration is idempotent (can run multiple times safely)

**Success Criteria:**
- **SC-004**: 100% of migrations complete without blocking failures
- **SC-005**: Schema validation catches malformed entries pre-migration
- **SC-006**: Rollback mechanism available for failed migrations

#### US-003: Integrity Verification & Audit Trails [P1]
**As a** compliance analyst reviewing AI governance  
**I want** comprehensive integrity verification with audit logs  
**So that** I can prove instruction authenticity and detect drift

**Acceptance Criteria:**
- **Given** a loaded instruction catalog
- **When** I call integrity/verify tool
- **Then** all instructions are validated against stored source hashes
- **And** any detected drift is reported with details

**Success Criteria:**
- **SC-007**: Integrity verification completes in <10 seconds for 10k instructions
- **SC-008**: 100% detection rate for tampered instruction bodies
- **SC-009**: Audit logs capture all catalog modifications with timestamps

### Priority 2: Enhanced Governance & Observability

#### US-004: Governance Metadata Updates [P2]
**As a** governance engineer maintaining instruction lifecycles  
**I want** metadata-only updates without rewriting instruction bodies  
**So that** I can efficiently manage review cycles and ownership

**Acceptance Criteria:**
- **Given** an existing instruction with metadata fields
- **When** I update owner status or reviewDate via instructions/governanceUpdate
- **Then** metadata changes persist without touching instruction body
- **And** governance hash updates to reflect new metadata

**Success Criteria:**
- **SC-010**: Metadata updates complete in <50ms
- **SC-011**: No body rewrite on metadata-only operations
- **SC-012**: Governance hash changes are deterministic and documented

## Functional Requirements (See full spec.md in docs/specs/)

### Catalog Management
**FR-001**: Schema support v1/v2/v3 with idempotent migrations  
**FR-002**: Deterministic source hashing (SHA-256)  
**FR-003**: Per-file error isolation during catalog load  

### Integrity & Governance
**FR-004**: Source hash validation and tamper detection  
**FR-005**: Governance metadata projection and hashing  
**FR-006**: Metadata-only update support  

### Feedback System
**FR-007**: Complete 6-tool feedback lifecycle (submit/list/get/update/stats/health)  
**FR-008**: Enumerated types and status workflow  
**FR-009**: Atomic persistence with rotation  

### Performance
**PR-001**: <5s catalog load for 10k instructions  
**PR-002**: <120ms P95 search latency  
**PR-003**: <10s integrity verification  

## Cross-References
- [Technical Plan (plan.md)](./plan.md) - Architecture and implementation
- [PROJECT_PRD.md](../PROJECT_PRD.md) - Binding governance document v1.4.2
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture diagrams
- [TESTING.md](../TESTING.md) - Testing strategy and coverage
