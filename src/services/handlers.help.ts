/**
 * Onboarding / Help Handlers
 *
 * Provides a stable read-only tool 'help/overview' that returns structured
 * onboarding guidance so a naive / first-time agent can self-bootstrap:
 * - Discover tools & their purpose
 * - Understand local (P0) vs indexed (P1+) lifecycle & promotion workflow
 * - Learn safe mutation enabling pattern (MCP_ENABLE_MUTATION)
 * - Follow a deterministic promotion checklist
 * - Avoid governance/spec recursion (documents intentionally NOT ingested)
 */
import { registerHandler } from '../server/registry';
import { getToolRegistry } from './toolRegistry';
import { getCatalogState } from './catalogContext';

const HELP_VERSION = '2025-09-14';

interface OverviewSection {
  id: string; title: string; content: string; bullets?: string[]; nextActions?: string[];
}

function buildSections(): OverviewSection[] {
  return [
    {
      id: 'intro',
      title: 'Welcome',
      content: 'This server exposes a governance-aware instruction catalog and supporting MCP tools. Use this overview to learn discovery, lifecycle tiers, and safe promotion patterns.'
    },
    {
      id: 'discovery',
      title: 'Tool Discovery Flow',
      content: 'Initialize (initialize), then enumerate capabilities via meta/tools or tools/list. Call help/overview for structured guidance before attempting mutations.',
      bullets: [
        'initialize → tools/call meta/tools → tools/call help/overview',
        'instructions/dispatch (action=list) to enumerate catalog entries',
        'instructions/governanceHash for deterministic governance projection',
        'instructions/health to assess drift & recursionRisk'
      ],
      nextActions: ['Call meta/tools', 'Call help/overview', 'List catalog via instructions/dispatch {action:list}']
    },
    {
      id: 'lifecycle',
      title: 'Lifecycle Tiers',
      content: 'Instructions progress from local experimental (P0) to indexed stable (P1+) via explicit promotion. Governance documents (constitution, specs) are excluded from ingestion to prevent recursion.',
      bullets: [
        'P0 Local: workspace-specific, rapid iteration, not shareable',
        'P1 Indexed: canonical, versioned, governance-compliant',
        'Higher tiers (P2+): optional refinement / broader distribution',
        'Denylist prevents governance/spec ingestion (see recursionRisk metric)'
      ]
    },
    {
      id: 'promotion',
      title: 'Promotion Checklist',
      content: 'Before promoting a P0 instruction to index ensure quality, clarity, and uniqueness benchmarks are satisfied.',
      bullets: [
        'Clarity: concise title + semantic summary',
        'Accuracy: verified against current repo state',
        'Value: non-duplicative & materially helpful',
        'Maintainability: minimal volatile references',
        'Classification & priorityTier assigned',
        'Owner + review cadence set (lastReviewedAt/nextReviewDue)',
        'ChangeLog initialized if version > 1'
      ],
      nextActions: ['Run prompt/review for large bodies', 'Run integrity/verify', 'Submit via instructions/add']
    },
    {
      id: 'mutation-safety',
      title: 'Safe Mutation',
      content: 'All write operations require MCP_ENABLE_MUTATION=1. Without it, mutation tools return disabled errors ensuring read-only safety by default.'
    },
    {
      id: 'recursion-safeguards',
      title: 'Recursion Safeguards',
      content: 'Loader denylist excludes governance/spec seeds. instructions/health exposes recursionRisk and leakage metrics; expected value is recursionRisk=none.'
    },
    {
      id: 'next-steps',
      title: 'Suggested Next Steps',
      content: 'Follow these steps to integrate effectively.',
      bullets: [
        '1. Fetch meta/tools and record stable tools',
        '2. List catalog entries (instructions/dispatch list)',
        '3. Track usage for relevant instructions (usage/track)',
        '4. Draft local P0 improvements in a separate directory',
        '5. Evaluate with prompt/review & integrity/verify',
        '6. Promote via instructions/add (with mutation enabled)' ,
        '7. Monitor drift via instructions/health and governanceHash'
      ]
    }
  ];
}

registerHandler('help/overview', () => {
  const registry = getToolRegistry().map(t => t.name);
  const catalog = getCatalogState();
  return {
    generatedAt: new Date().toISOString(),
    version: HELP_VERSION,
    summary: 'Structured onboarding guidance for new agents: discovery → lifecycle → promotion → safety.',
    sections: buildSections(),
    toolDiscovery: {
      primary: registry.filter(n => !n.startsWith('diagnostics/')),
      diagnostics: registry.filter(n => n.startsWith('diagnostics/'))
    },
    lifecycleModel: {
      tiers: [
        { tier: 'P0', purpose: 'Local experimental / workspace-scoped, not indexed' },
        { tier: 'P1', purpose: 'Indexed baseline, governance compliant' },
        { tier: 'P2', purpose: 'Refined / broader consumption (optional)' }
      ],
      promotionChecklist: [
        'Ensure uniqueness (no near-duplicate id/body)',
        'Provide semantic summary & owner',
        'Assign priorityTier & classification',
        'Set review dates',
        'Pass integrity/verify and governanceHash stable'
      ]
    },
    catalog: { count: catalog.list.length, hash: catalog.hash }
  };
});
