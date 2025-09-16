/**
 * Test Suite for MCP Instructions Search Tool
 * 
 * Validates the instructions/search tool functionality including:
 * - Keyword matching against titles, bodies, and categories
 * - Case sensitivity options
 * - Input validation and error handling
 * - MCP protocol compliance
 * - Performance with large instruction sets
 * - Relevance scoring accuracy
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleInstructionsSearch } from '../services/handlers.search';
import { InstructionEntry } from '../models/instruction';

// Mock instruction catalog for testing
const mockInstructions: InstructionEntry[] = [
  {
    id: 'test-001',
    title: 'JavaScript Array Methods',
    body: 'Learn about map, filter, reduce, and forEach methods for JavaScript arrays. These are essential functional programming techniques.',
    priority: 10,
    audience: 'all',
    requirement: 'recommended',
    categories: ['javascript', 'programming', 'arrays'],
    sourceHash: 'hash1',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-002',
    title: 'TypeScript Interface Design',
    body: 'Best practices for designing TypeScript interfaces. Include proper typing for complex objects and union types.',
    priority: 5,
    audience: 'all',
    requirement: 'mandatory',
    categories: ['typescript', 'programming', 'interfaces'],
    sourceHash: 'hash2',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-003',
    title: 'React Component Lifecycle',
    body: 'Understanding React component lifecycle methods and hooks. Learn useEffect, useState, and custom hooks.',
    priority: 15,
    audience: 'all',
    requirement: 'recommended',
    categories: ['react', 'frontend', 'javascript'],
    sourceHash: 'hash3',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-004',
    title: 'Database Query Optimization',
    body: 'Techniques for optimizing SQL queries and database performance. Focus on indexing and query planning.',
    priority: 8,
    audience: 'all',
    requirement: 'critical',
    categories: ['database', 'sql', 'performance'],
    sourceHash: 'hash4',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  },
  {
    id: 'test-005',
    title: 'API Security Best Practices',
    body: 'Security considerations for REST APIs including authentication, authorization, and data validation.',
    priority: 3,
    audience: 'all',
    requirement: 'mandatory',
    categories: ['security', 'api', 'backend'],
    sourceHash: 'hash5',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z'
  }
];

// Mock the catalog context
vi.mock('../services/catalogContext', () => ({
  ensureLoaded: () => ({
    list: mockInstructions,
    hash: 'test-hash'
  })
}));

describe('Instructions Search Tool', () => {
  beforeEach(() => {
    // Reset any environment variables
    delete process.env.MCP_LOG_SEARCH;
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('Basic Search Functionality', () => {
    it('should find instructions by title keyword', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });

      expect(result.results).toHaveLength(2);
      expect(result.results[0].instructionId).toBe('test-001'); // Should be first due to title match
      expect(result.results[1].instructionId).toBe('test-003'); // React (JavaScript in categories)
      expect(result.totalMatches).toBe(2);
    });

    it('should find instructions by body keyword', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['optimization']
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('test-004');
      expect(result.results[0].matchedFields).toContain('body');
    });

    it('should find instructions by category when includeCategories is true', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['security'],
        includeCategories: true
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('test-005');
      expect(result.results[0].matchedFields).toContain('categories');
    });

    it('should not search categories when includeCategories is false', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['sql'],
        includeCategories: false
      });

      expect(result.results).toHaveLength(0);
    });
  });

  describe('Multiple Keyword Search', () => {
    it('should handle multiple keywords with AND logic', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['TypeScript', 'interface']
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('test-002');
      expect(result.results[0].relevanceScore).toBeGreaterThan(10); // Bonus for multiple matches
    });

    it('should rank results by relevance score', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['programming'],
        includeCategories: true
      });

      expect(result.results.length).toBeGreaterThan(1);
      // Results should be sorted by relevance score descending
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i-1].relevanceScore).toBeGreaterThanOrEqual(result.results[i].relevanceScore);
      }
    });
  });

  describe('Case Sensitivity', () => {
    it('should be case-insensitive by default', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['javascript']
      });

      expect(result.results).toHaveLength(2);
      expect(result.query.caseSensitive).toBe(false);
    });

    it('should respect case sensitivity when enabled', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['javascript'], // lowercase
        caseSensitive: true
      });

      // Should only find lowercase matches in categories, not title "JavaScript"
      expect(result.results).toHaveLength(1);
      expect(result.results[0].instructionId).toBe('test-003'); // React has 'javascript' in categories
    });
  });

  describe('Input Validation', () => {
    it('should require keywords parameter', async () => {
      await expect(handleInstructionsSearch({} as any)).rejects.toThrow('At least one keyword is required');
    });

    it('should require keywords to be an array', async () => {
      await expect(handleInstructionsSearch({ keywords: 'not-array' } as any)).rejects.toThrow('Invalid keywords: expected array');
    });

    it('should reject empty keywords array', async () => {
      await expect(handleInstructionsSearch({ keywords: [] })).rejects.toThrow('At least one keyword is required');
    });

    it('should reject non-string keywords', async () => {
      await expect(handleInstructionsSearch({ keywords: [123] } as any)).rejects.toThrow('All keywords must be strings');
    });

    it('should reject empty string keywords', async () => {
      await expect(handleInstructionsSearch({ keywords: ['', 'valid'] })).rejects.toThrow('Keywords cannot be empty');
    });

    it('should reject keywords longer than 100 characters', async () => {
      const longKeyword = 'a'.repeat(101);
      await expect(handleInstructionsSearch({ keywords: [longKeyword] })).rejects.toThrow('Keywords cannot exceed 100 characters');
    });

    it('should enforce maximum 10 keywords', async () => {
      const tooManyKeywords = Array(11).fill('keyword');
      await expect(handleInstructionsSearch({ keywords: tooManyKeywords })).rejects.toThrow('Maximum 10 keywords allowed');
    });

    it('should validate limit parameter', async () => {
      await expect(handleInstructionsSearch({ keywords: ['test'], limit: 0 })).rejects.toThrow('Limit must be a number between 1 and 100');
      await expect(handleInstructionsSearch({ keywords: ['test'], limit: 101 })).rejects.toThrow('Limit must be a number between 1 and 100');
      await expect(handleInstructionsSearch({ keywords: ['test'], limit: 'invalid' } as any)).rejects.toThrow('Limit must be a number between 1 and 100');
    });

    it('should validate boolean parameters', async () => {
      await expect(handleInstructionsSearch({ keywords: ['test'], includeCategories: 'invalid' } as any)).rejects.toThrow('includeCategories must be a boolean');
      await expect(handleInstructionsSearch({ keywords: ['test'], caseSensitive: 'invalid' } as any)).rejects.toThrow('caseSensitive must be a boolean');
    });
  });

  describe('Limit and Pagination', () => {
    it('should apply default limit of 50', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['test'] // This won't match our mock data, but tests default
      });

      expect(result.query.limit).toBe(50);
    });

    it('should apply custom limit', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['programming'],
        includeCategories: true,
        limit: 2
      });

      expect(result.results.length).toBeLessThanOrEqual(2);
      expect(result.query.limit).toBe(2);
    });

    it('should enforce maximum limit of 100', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['test'],
        limit: 150 // Should be capped at 100
      });

      expect(result.query.limit).toBe(100);
    });
  });

  describe('Response Format', () => {
    it('should return proper response structure', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['JavaScript']
      });

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('totalMatches');
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('executionTimeMs');

      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.totalMatches).toBe('number');
      expect(typeof result.executionTimeMs).toBe('number');

      if (result.results.length > 0) {
        const firstResult = result.results[0];
        expect(firstResult).toHaveProperty('instructionId');
        expect(firstResult).toHaveProperty('relevanceScore');
        expect(firstResult).toHaveProperty('matchedFields');
        expect(Array.isArray(firstResult.matchedFields)).toBe(true);
      }
    });

    it('should include query parameters in response', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['test'],
        limit: 25,
        includeCategories: true,
        caseSensitive: false
      });

      expect(result.query).toEqual({
        keywords: ['test'],
        limit: 25,
        includeCategories: true,
        caseSensitive: false
      });
    });
  });

  describe('Performance', () => {
    it('should complete search within reasonable time', async () => {
      const start = Date.now();
      const result = await handleInstructionsSearch({
        keywords: ['programming']
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(result.executionTimeMs).toBeGreaterThan(0);
      expect(result.executionTimeMs).toBeLessThan(duration + 50); // Allow some measurement variance
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in keywords', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['@#$%^&*()']
      });

      expect(result.results).toHaveLength(0);
      expect(result.totalMatches).toBe(0);
    });

    it('should handle whitespace-only keywords by trimming them', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['  JavaScript  ', '\t\n']
      });

      // Should effectively search for just 'JavaScript' after trimming
      expect(result.query.keywords).toEqual(['JavaScript']);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('should handle empty search results gracefully', async () => {
      const result = await handleInstructionsSearch({
        keywords: ['nonexistentkeyword123']
      });

      expect(result.results).toHaveLength(0);
      expect(result.totalMatches).toBe(0);
      expect(result.executionTimeMs).toBeGreaterThan(0);
    });
  });
});