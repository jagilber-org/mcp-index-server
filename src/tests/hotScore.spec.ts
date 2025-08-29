/**
 * Phase 3 Hot Score Service Test Suite
 * 
 * Comprehensive test coverage for enterprise-grade instruction ranking
 * with temporal usage patterns, recency weighting, and configurable bonuses.
 * 
 * @test-suite HotScore
 * @version 1.0.0
 * @since Phase 3 Implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  HotScoreService, 
  DEFAULT_HOT_SCORE_CONFIG, 
  createHotScoreService,
  type HotScoreConfig,
  type UsagePoint
} from '../services/hotScore.js';

describe('HotScoreService', () => {
  let hotScoreService: HotScoreService;
  const baseTime = Date.now();

  beforeEach(() => {
    hotScoreService = new HotScoreService();
  });

  describe('Configuration Management', () => {
    it('should initialize with default configuration', () => {
      const service = new HotScoreService();
      const config = service.getConfig();

      expect(config.recencyWeight).toBe(DEFAULT_HOT_SCORE_CONFIG.recencyWeight);
      expect(config.historyWeight).toBe(DEFAULT_HOT_SCORE_CONFIG.historyWeight);
      expect(config.temporalDecay).toBe(DEFAULT_HOT_SCORE_CONFIG.temporalDecay);
      expect(config.minScoreThreshold).toBe(DEFAULT_HOT_SCORE_CONFIG.minScoreThreshold);
    });

    it('should accept custom configuration overrides', () => {
      const customConfig: HotScoreConfig = {
        ...DEFAULT_HOT_SCORE_CONFIG,
        recencyWeight: 0.8,
        historyWeight: 0.2,
        temporalDecay: 0.9
      };

      const service = new HotScoreService(customConfig);
      const config = service.getConfig();

      expect(config.recencyWeight).toBe(0.8);
      expect(config.historyWeight).toBe(0.2);
      expect(config.temporalDecay).toBe(0.9);
    });

    it('should update configuration dynamically', () => {
      const service = new HotScoreService();
      
      service.updateConfig({
        recencyWeight: 0.9,
        minScoreThreshold: 0.05
      });

      const config = service.getConfig();
      expect(config.recencyWeight).toBe(0.9);
      expect(config.minScoreThreshold).toBe(0.05);
      // Other values should remain unchanged
      expect(config.historyWeight).toBe(DEFAULT_HOT_SCORE_CONFIG.historyWeight);
    });
  });

  describe('Empty Usage History', () => {
    it('should return zero score for empty usage history', () => {
      const result = hotScoreService.calculateHotScore('test-id', []);

      expect(result.score).toBe(0);
      expect(result.breakdown.recentUsage).toBe(0);
      expect(result.breakdown.historicalUsage).toBe(0);
      expect(result.breakdown.bonuses).toBe(0);
      expect(result.metadata.totalUsageEvents).toBe(0);
    });

    it('should return zero score for usage beyond lookback window', () => {
      const oldUsage: UsagePoint[] = [
        { timestamp: baseTime - (200 * 60 * 60 * 1000), count: 10 } // 200 hours ago (beyond 168h window)
      ];

      const result = hotScoreService.calculateHotScore('test-id', oldUsage, baseTime);
      expect(result.score).toBe(0);
    });
  });

  describe('Recent Usage Scoring', () => {
    it('should prioritize recent usage with high recency weight', () => {
      const recentUsage: UsagePoint[] = [
        { timestamp: baseTime - (2 * 60 * 60 * 1000), count: 5 }, // 2 hours ago
        { timestamp: baseTime - (12 * 60 * 60 * 1000), count: 3 }, // 12 hours ago
      ];

      const result = hotScoreService.calculateHotScore('test-id', recentUsage, baseTime);

      expect(result.score).toBeGreaterThan(0);
      expect(result.breakdown.recentUsage).toBeGreaterThan(0);
      expect(result.breakdown.recencyContribution).toBeGreaterThan(0);
      expect(result.breakdown.historyContribution).toBe(0); // No historical usage
    });

    it('should apply temporal decay to recent usage', () => {
      const immediateUsage: UsagePoint[] = [
        { timestamp: baseTime - (1000), count: 1 } // 1 second ago
      ];
      
      const olderUsage: UsagePoint[] = [
        { timestamp: baseTime - (10 * 60 * 60 * 1000), count: 1 } // 10 hours ago
      ];

      const immediateResult = hotScoreService.calculateHotScore('immediate', immediateUsage, baseTime);
      const olderResult = hotScoreService.calculateHotScore('older', olderUsage, baseTime);

      // More recent usage should have higher score due to less temporal decay
      expect(immediateResult.score).toBeGreaterThan(olderResult.score);
    });
  });

  describe('Historical Usage Scoring', () => {
    it('should incorporate historical usage beyond 24 hours', () => {
      const mixedUsage: UsagePoint[] = [
        { timestamp: baseTime - (2 * 60 * 60 * 1000), count: 2 }, // Recent: 2 hours ago
        { timestamp: baseTime - (48 * 60 * 60 * 1000), count: 3 }, // Historical: 48 hours ago
        { timestamp: baseTime - (72 * 60 * 60 * 1000), count: 1 }, // Historical: 72 hours ago
      ];

      const result = hotScoreService.calculateHotScore('mixed', mixedUsage, baseTime);

      expect(result.breakdown.recentUsage).toBeGreaterThan(0);
      expect(result.breakdown.historicalUsage).toBeGreaterThan(0);
      expect(result.breakdown.recencyContribution).toBeGreaterThan(0);
      expect(result.breakdown.historyContribution).toBeGreaterThan(0);
    });

    it('should weight recent usage higher than historical by default', () => {
      const sameCountUsage: UsagePoint[] = [
        { timestamp: baseTime - (12 * 60 * 60 * 1000), count: 5 }, // Recent
        { timestamp: baseTime - (48 * 60 * 60 * 1000), count: 5 }, // Historical
      ];

      const result = hotScoreService.calculateHotScore('weighted', sameCountUsage, baseTime);

      // With default 0.7 vs 0.3 weighting, recent should contribute more
      expect(result.breakdown.recencyContribution).toBeGreaterThan(result.breakdown.historyContribution);
    });
  });

  describe('Bonus System', () => {
    it('should apply first use bonus for single usage', () => {
      const firstUse: UsagePoint[] = [
        { timestamp: baseTime - (1000), count: 1 }
      ];

      const result = hotScoreService.calculateHotScore('first-use', firstUse, baseTime);

      expect(result.breakdown.bonuses).toBe(DEFAULT_HOT_SCORE_CONFIG.firstUseBonus);
    });

    it('should apply diversity bonus for varied usage patterns', () => {
      const diverseUsage: UsagePoint[] = [
        { timestamp: baseTime - (1 * 60 * 60 * 1000), count: 1 }, // Hour 1
        { timestamp: baseTime - (5 * 60 * 60 * 1000), count: 1 }, // Hour 5
        { timestamp: baseTime - (10 * 60 * 60 * 1000), count: 1 }, // Hour 10
      ];

      const result = hotScoreService.calculateHotScore('diverse', diverseUsage, baseTime);

      expect(result.breakdown.bonuses).toBe(DEFAULT_HOT_SCORE_CONFIG.diversityBonus);
      expect(result.metadata.uniqueHours).toBe(3);
    });

    it('should not apply diversity bonus for concentrated usage', () => {
      const concentratedUsage: UsagePoint[] = [
        { timestamp: baseTime - (1000), count: 1 },
        { timestamp: baseTime - (2000), count: 1 }, // Same hour
      ];

      const result = hotScoreService.calculateHotScore('concentrated', concentratedUsage, baseTime);

      expect(result.breakdown.bonuses).toBe(0); // No diversity bonus
      expect(result.metadata.uniqueHours).toBe(1);
    });
  });

  describe('Metadata Generation', () => {
    it('should generate comprehensive usage metadata', () => {
      const complexUsage: UsagePoint[] = [
        { timestamp: baseTime - (1 * 60 * 60 * 1000), count: 3 },
        { timestamp: baseTime - (6 * 60 * 60 * 1000), count: 2 },
        { timestamp: baseTime - (24 * 60 * 60 * 1000), count: 1 },
        { timestamp: baseTime - (48 * 60 * 60 * 1000), count: 4 }
      ];

      const result = hotScoreService.calculateHotScore('complex', complexUsage, baseTime);

      expect(result.metadata.totalUsageEvents).toBe(10); // 3+2+1+4
      expect(result.metadata.uniqueHours).toBe(4);
      expect(result.metadata.firstUsage).toBe(baseTime - (48 * 60 * 60 * 1000));
      expect(result.metadata.lastUsage).toBe(baseTime - (1 * 60 * 60 * 1000));
      expect(result.metadata.usageTrend).toMatch(/increasing|decreasing|stable/);
    });

    it('should detect increasing usage trend', () => {
      const increasingUsage: UsagePoint[] = [
        { timestamp: baseTime - (1 * 60 * 60 * 1000), count: 10 }, // Recent: heavy usage
        { timestamp: baseTime - (48 * 60 * 60 * 1000), count: 1 }, // Historical: light usage
        { timestamp: baseTime - (96 * 60 * 60 * 1000), count: 1 }
      ];

      const result = hotScoreService.calculateHotScore('increasing', increasingUsage, baseTime);
      expect(result.metadata.usageTrend).toBe('increasing');
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple instructions efficiently', () => {
      const instructionUsage = new Map<string, UsagePoint[]>([
        ['inst-1', [{ timestamp: baseTime - (1000), count: 5 }]],
        ['inst-2', [{ timestamp: baseTime - (2 * 60 * 60 * 1000), count: 3 }]],
        ['inst-3', [{ timestamp: baseTime - (200 * 60 * 60 * 1000), count: 1 }]] // Beyond window
      ]);

      const results = hotScoreService.calculateBatchHotScores(instructionUsage, baseTime);

      expect(results.size).toBe(2); // inst-3 filtered out by threshold/window
      expect(results.has('inst-1')).toBe(true);
      expect(results.has('inst-2')).toBe(true);
      expect(results.has('inst-3')).toBe(false);
    });

    it('should apply minimum score threshold in batch processing', () => {
      const lowScoreService = new HotScoreService({
        ...DEFAULT_HOT_SCORE_CONFIG,
        minScoreThreshold: 1.0 // High threshold
      });

      const instructionUsage = new Map<string, UsagePoint[]>([
        ['low-score', [{ timestamp: baseTime - (100 * 60 * 60 * 1000), count: 1 }]], // Very old, low score
        ['high-score', [{ timestamp: baseTime - (1000), count: 10 }]] // Recent, high score
      ]);

      const results = lowScoreService.calculateBatchHotScores(instructionUsage, baseTime);

      // Only high-score instruction should pass threshold
      expect(results.has('high-score')).toBe(true);
      expect(results.has('low-score')).toBe(false);
    });
  });

  describe('Edge Cases and Robustness', () => {
    it('should handle future timestamps gracefully', () => {
      const futureUsage: UsagePoint[] = [
        { timestamp: baseTime + (60 * 60 * 1000), count: 1 } // 1 hour in future
      ];

      const result = hotScoreService.calculateHotScore('future', futureUsage, baseTime);
      expect(result.score).toBe(0); // Future usage should be filtered out
    });

    it('should handle zero count usage points', () => {
      const zeroUsage: UsagePoint[] = [
        { timestamp: baseTime - (1000), count: 0 },
        { timestamp: baseTime - (2000), count: 1 }
      ];

      const result = hotScoreService.calculateHotScore('zero-count', zeroUsage, baseTime);
      expect(result.score).toBeGreaterThan(0); // Should still score from non-zero count
    });

    it('should handle very large usage counts', () => {
      const largeUsage: UsagePoint[] = [
        { timestamp: baseTime - (1000), count: 1000000 }
      ];

      const result = hotScoreService.calculateHotScore('large-count', largeUsage, baseTime);
      expect(result.score).toBeGreaterThan(100); // Should handle large numbers
      expect(result.metadata.totalUsageEvents).toBe(1000000);
    });

    it('should sort usage history correctly regardless of input order', () => {
      const unorderedUsage: UsagePoint[] = [
        { timestamp: baseTime - (12 * 60 * 60 * 1000), count: 2 },
        { timestamp: baseTime - (1 * 60 * 60 * 1000), count: 3 },
        { timestamp: baseTime - (6 * 60 * 60 * 1000), count: 1 }
      ];

      const result = hotScoreService.calculateHotScore('unordered', unorderedUsage, baseTime);
      
      // Should process correctly regardless of order
      expect(result.score).toBeGreaterThan(0);
      expect(result.metadata.firstUsage).toBe(baseTime - (12 * 60 * 60 * 1000));
      expect(result.metadata.lastUsage).toBe(baseTime - (1 * 60 * 60 * 1000));
    });
  });

  describe('Factory Function', () => {
    it('should create service with default config via factory', () => {
      const service = createHotScoreService();
      const config = service.getConfig();
      
      expect(config).toEqual(DEFAULT_HOT_SCORE_CONFIG);
    });

    it('should create service with overrides via factory', () => {
      const service = createHotScoreService({
        recencyWeight: 0.9,
        temporalDecay: 0.8
      });
      
      const config = service.getConfig();
      expect(config.recencyWeight).toBe(0.9);
      expect(config.temporalDecay).toBe(0.8);
      expect(config.historyWeight).toBe(DEFAULT_HOT_SCORE_CONFIG.historyWeight); // Unchanged
    });
  });
});
