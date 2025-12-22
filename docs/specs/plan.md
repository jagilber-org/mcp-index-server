# MCP Index Server - Technical Plan

## Technical Context

### Language & Runtime
- **Primary Language**: TypeScript 5.3+
- **Runtime**: Node.js 18.x LTS (minimum)
- **Build System**: tsc (TypeScript compiler)
- **Package Manager**: npm 9+

### Key Dependencies
- **@modelcontextprotocol/sdk** (^1.0.0): MCP protocol implementation
- **zod** (^3.22.0): Runtime type validation and schema definition
- **fast-glob**: Directory traversal for instruction loading

### Platform Constraints
- **Target Platforms**: Windows 10/11, macOS 12+, Ubuntu 20.04+
- **Architectures**: x86_64, ARM64
- **Minimum RAM**: 512MB (2GB recommended for 10k+ instructions)
- **Disk Space**: ~100MB installation + variable for instruction catalogs

## Project Structure

```
mcp-index-server/
├── src/
│   ├── index.ts                  # MCP server entry point
│   ├── server.ts                 # Core server implementation
│   ├── catalog/
│   │   ├── loader.ts             # Instruction directory loading
│   │   ├── validator.ts          # Schema validation (v1/v2/v3)
│   │   ├── migrator.ts           # Schema migration engine
│   │   └── normalizer.ts         # Changelog normalization
│   ├── governance/
│   │   ├── hash.ts               # Deterministic governance hashing
│   │   ├── metadata.ts           # Metadata-only updates
│   │   ├── drift.ts              # Hash drift detection
│   │   └── integrity.ts          # Source hash verification
│   ├── feedback/
│   │   ├── submit.ts             # Feedback submission tool
│   │   ├── list.ts               # Filterable feedback retrieval
│   │   ├── update.ts             # Status workflow management
│   │   └── persistence.ts        # Atomic file writes
│   ├── tools/
│   │   ├── instructions/         # Instruction CRUD tools
│   │   ├── governance/           # Governance tools
│   │   ├── integrity/            # Integrity verification tools
│   │   ├── manifest/             # Manifest management tools
│   │   ├── feedback/             # Feedback lifecycle tools
│   │   ├── metrics/              # Observability tools
│   │   └── usage/                # Usage tracking tools
│   ├── types/
│   │   ├── instruction-v1.ts     # Schema v1 definitions
│   │   ├── instruction-v2.ts     # Schema v2 definitions
│   │   ├── instruction-v3.ts     # Schema v3 definitions (current)
│   │   └── mcp-schemas.ts        # Zod schemas for MCP tools
│   └── utils/
│       ├── logger.ts             # Logging utility
│       ├── atomic-write.ts       # Temp file + rename pattern
│       └── manifest-helper.ts    # Manifest observability
├── tests/
│   ├── createReadSmoke.spec.ts          # Baseline: Create/read smoke test
│   ├── portableCrudAtomic.spec.ts       # Baseline: Atomic operations
│   ├── governanceHashIntegrity.spec.ts  # Baseline: Hash stability (6 scenarios)
│   ├── instructionsAddPersistence.spec.ts # Baseline: Persistence validation
│   ├── schemaMigration.spec.ts          # Migration idempotency tests
│   └── feedbackLifecycle.spec.ts        # Feedback workflow tests
├── docs/
│   ├── specs/
│   │   ├── spec.md               # THIS: GitHub spec-kit product specification
│   │   └── plan.md               # THIS: Technical plan
│   ├── PROJECT_PRD.md            # Binding governance document (v1.4.2)
│   ├── ARCHITECTURE.md           # System architecture
│   ├── TESTING.md                # Testing strategy and coverage
│   ├── CONFIGURATION.md          # Configuration management
│   ├── TESTING-STRATEGY.md       # Comprehensive test strategy
│   ├── GRAPH.md                  # Instruction relationship graphs
│   ├── MANIFEST.md               # Manifest subsystem details
│   └── [40+ additional docs]     # Comprehensive documentation suite
├── README.md                     # Project overview and quickstart
├── package.json                  # NPM package configuration
├── tsconfig.json                 # TypeScript compiler config
└── jest.config.js                # Jest testing configuration
```

## Architecture Overview

> **Note**: For comprehensive architecture details, see [docs/ARCHITECTURE.md](../ARCHITECTURE.md)

### Catalog Loading & Validation
- Fast-glob scans instruction directories
- Per-file error isolation (failed loads don't block catalog)
- Schema versioning with automatic migration support
- Deterministic source hash (SHA-256 of normalized body)

### Governance System
- Metadata projection for governance hashing
- Metadata-only updates preserve instruction bodies
- Hash drift tracking with documented exceptions
- Integrity verification against stored source hashes

### Feedback Lifecycle
- 6-tool complete feedback system (submit/list/get/update/stats/health)
- Atomic writes with temp file + rename strategy
- Rotation on max entries to prevent unbounded growth
- Status workflow: new → acknowledged → in-progress → resolved → closed

### Manifest Observability
- Opportunistic in-memory materialization (eliminates add→get races)
- Skip path self-healing reduces disk churn
- Drift diagnostics (missing/extra IDs, count mismatches)
- MCP_MANIFEST_WRITE=0 for safe read-only diagnostics

## Implementation Status

> **Current Status**: Phase 7 (Portfolio Preparation) - Core functionality complete

### Phase 1-6: COMPLETE ✅
- ✅ Catalog loading with schema validation
- ✅ Schema migration v1→v2→v3
- ✅ Governance hashing and integrity verification
- ✅ Feedback system (6 tools)
- ✅ Manifest observability and drift detection
- ✅ Usage tracking and metrics
- ✅ Comprehensive test suite (90%+ coverage)

### Phase 7: Portfolio Preparation 🔄
- ✅ Create GitHub spec-kit formatted spec.md
- 🔄 Create plan.md (THIS DOCUMENT)
- ⏳ Update README to reference specs/
- ⏳ Ensure cross-references between all docs

### Baseline Test Suite (MUST stay green)
These tests form the nucleus of quality gates:
- **createReadSmoke.spec.ts**: Basic CRUD smoke test
- **portableCrudAtomic.spec.ts**: Atomic operation guarantees
- **portableCrudParameterized.spec.ts**: Parameterized CRUD scenarios
- **portableCrudHarness.spec.ts**: CRUD test harness
- **instructionsAddPersistence.spec.ts**: Persistence validation
- **governanceHashIntegrity.spec.ts**: 6 scenarios (create-stability, body-update-change, metadata-stability, multi-create consistency, overwrite-or-skip, drift lifecycle)

## Performance Targets

**Achieved Targets:**
- ✅ Catalog load: <5s for 10,000 instructions
- ✅ P95 search latency: <120ms at 10k catalog size
- ✅ Integrity verification: <10s for 10k instructions
- ✅ Metadata updates: <50ms median
- ✅ Feedback submit: <50ms median

## Constitution Check

### Project Alignment
✅ **Aligns with MCP ecosystem**: Enables governance-aware instruction management for AI assistants  
✅ **Solves real problems**: Enterprise governance and compliance for AI prompt management  
✅ **Demonstrates expertise**: Schema evolution, integrity verification, deterministic hashing, comprehensive testing  
✅ **Portfolio showcase**: 108+ hours investment, production-ready enterprise platform

### Technical Soundness
✅ **TypeScript best practices**: Strict mode, comprehensive types, Zod validation  
✅ **Testing rigor**: 90%+ coverage, baseline test suite with 100 consecutive run requirement  
✅ **Schema evolution**: Idempotent migrations, backward compatibility, rollback support  
✅ **Performance conscious**: Sub-120ms P95 latency, debounced persistence, efficient hashing

### Documentation Excellence
✅ **Comprehensive existing docs**: 40+ documentation files covering architecture, testing, configuration, etc.  
✅ **Binding governance**: PROJECT_PRD.md v1.4.2 serves as authoritative requirements document  
✅ **Mermaid diagrams**: Architecture, sequence diagrams, state machines (in ARCHITECTURE.md)  
✅ **Testing strategy**: Detailed TESTING.md and TESTING-STRATEGY.md

## Success Criteria

**Technical Excellence:**
- ✅ All baseline tests passing with 90%+ coverage
- ✅ Zero high-severity security vulnerabilities
- ✅ Performance targets met (<120ms P95, <5s catalog load)
- ✅ Schema migration success rate: 100%

**Portfolio Presentation:**
- ✅ Professional documentation suite (40+ docs)
- 🔄 GitHub spec-kit compliance (spec.md, plan.md)
- ✅ Comprehensive architecture diagrams (ARCHITECTURE.md)
- ✅ Binding PRD with governance standards (PROJECT_PRD.md v1.4.2)

## Cross-References

**Related Documentation:**
- [Product Specification (spec.md)](./spec.md) - User scenarios and functional requirements
- [PROJECT_PRD.md](../PROJECT_PRD.md) - Binding governance document (v1.4.2)
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture with Mermaid diagrams
- [TESTING.md](../TESTING.md) - Testing strategy and coverage
- [TESTING-STRATEGY.md](../TESTING-STRATEGY.md) - Comprehensive test strategy
- [CONFIGURATION.md](../CONFIGURATION.md) - Configuration management
- [MANIFEST.md](../MANIFEST.md) - Manifest subsystem details
- [GRAPH.md](../GRAPH.md) - Instruction relationship graphs
- [DOCS-INDEX.md](../DOCS-INDEX.md) - Complete documentation index (40+ files)

## Timeline

**Total Duration**: 108+ hours WakaTime investment

- Weeks 1-20: Core development (catalog, governance, feedback, manifest) ✅
- Week 21: Portfolio preparation (GitHub spec-kit docs) 🔄
- Future: Community feedback and enhancements ⏳

**Current Status**: Phase 7 (Portfolio Preparation) - Creating GitHub spec-kit documentation

## Revision History

- 2025-12-22: Initial GitHub spec-kit format technical plan (v1.0.0)
- Portfolio preparation: Complements existing PROJECT_PRD.md v1.4.2 and comprehensive docs
- Organized into GitHub spec-kit structure with cross-references
- Highlights 108+ hour investment and enterprise-grade quality
