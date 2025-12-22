/**
 * MCP Instructions Search Handler
 * 
 * Provides keyword-based search functionality for discovering instruction IDs.
 * This is the PRIMARY discovery tool for MCP clients to find relevant instructions
 * before retrieving detailed content via instructions/get or instructions/dispatch.
 * 
 * Search Strategy:
 * - Multi-keyword support with configurable matching
 * - Searches instruction titles, bodies, and optionally categories
 * - Returns lightweight ID list for efficient follow-up queries
 * - Case-insensitive by default with case-sensitive option
 * - Relevance scoring based on match frequency and location
 * 
 * MCP Compliance:
 * - Full JSON Schema validation
 * - Structured error responses
 * - Proper tool registration
 * - Input sanitization and limits
 */

import { registerHandler } from '../server/registry';
import { logInfo, logWarn } from './logger';
import { InstructionEntry } from '../models/instruction';
import { ensureLoaded } from './catalogContext';

interface SearchParams {
  keywords: string[];
  limit?: number;
  includeCategories?: boolean;
  caseSensitive?: boolean;
}

interface SearchResult {
  instructionId: string;
  relevanceScore: number;
  matchedFields: ('title' | 'body' | 'categories')[];
}

interface SearchResponse {
  results: SearchResult[];
  totalMatches: number;
  query: {
    keywords: string[];
    limit: number;
    includeCategories: boolean;
    caseSensitive: boolean;
  };
  executionTimeMs: number;
}

/**
 * Calculate relevance score for an instruction based on keyword matches
 */
function calculateRelevance(
  instruction: InstructionEntry,
  keywords: string[],
  caseSensitive: boolean,
  includeCategories: boolean
): { score: number; matchedFields: ('title' | 'body' | 'categories')[] } {
  let score = 0;
  const matchedFields: ('title' | 'body' | 'categories')[] = [];
  
  const prepareText = (text: string) => caseSensitive ? text : text.toLowerCase();
  const preparedKeywords = keywords.map(k => prepareText(k));
  
  // Title matches (highest weight)
  const titleText = prepareText(instruction.title);
  let titleMatches = 0;
  for (const keyword of preparedKeywords) {
    if (titleText.includes(keyword)) {
      titleMatches++;
    }
  }
  if (titleMatches > 0) {
    score += titleMatches * 10; // 10 points per title match
    matchedFields.push('title');
  }
  
  // Body matches (medium weight)
  const bodyText = prepareText(instruction.body);
  let bodyMatches = 0;
  for (const keyword of preparedKeywords) {
    const matches = (bodyText.match(new RegExp(escapeRegex(keyword), caseSensitive ? 'g' : 'gi')) || []).length;
    bodyMatches += matches;
  }
  if (bodyMatches > 0) {
    score += Math.min(bodyMatches * 2, 20); // 2 points per body match, capped at 20
    matchedFields.push('body');
  }
  
  // Category matches (lower weight, optional)
  if (includeCategories && instruction.categories?.length) {
    const categoryText = prepareText(instruction.categories.join(' '));
    let categoryMatches = 0;
    for (const keyword of preparedKeywords) {
      if (categoryText.includes(keyword)) {
        categoryMatches++;
      }
    }
    if (categoryMatches > 0) {
      score += categoryMatches * 3; // 3 points per category match
      matchedFields.push('categories');
    }
  }
  
  // Bonus for matching multiple keywords
  const uniqueMatches = new Set();
  for (const keyword of preparedKeywords) {
    if (prepareText(instruction.title).includes(keyword) || 
        prepareText(instruction.body).includes(keyword) ||
        (includeCategories && instruction.categories?.some((cat: string) => prepareText(cat).includes(keyword)))) {
      uniqueMatches.add(keyword);
    }
  }
  
  if (uniqueMatches.size > 1) {
    score += (uniqueMatches.size - 1) * 5; // 5 bonus points for each additional keyword matched
  }
  
  return { score, matchedFields };
}

/**
 * Escape special regex characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Load and search instructions from the catalog
 */
function performSearch(params: SearchParams): SearchResponse {
  const startTime = performance.now();
  
  // Load instruction catalog state
  const state = ensureLoaded();
  
  if (!state || !state.list) {
    throw new Error('Instruction catalog not available');
  }
  
  // Ensure defaults are explicitly applied
  const keywords = params.keywords;
  const limit = params.limit ?? 50;
  const includeCategories = params.includeCategories ?? false;
  const caseSensitive = params.caseSensitive ?? false;
  
  // Validate and sanitize keywords
  const sanitizedKeywords = keywords
    .filter(k => typeof k === 'string' && k.trim().length > 0)
    .map(k => k.trim())
    .slice(0, 10); // Enforce max 10 keywords
  
  if (sanitizedKeywords.length === 0) {
    throw new Error('At least one valid keyword is required');
  }
  
  const results: SearchResult[] = [];
  
  // Search through all instructions
  for (const instruction of state.list) {
    const { score, matchedFields } = calculateRelevance(
      instruction,
      sanitizedKeywords,
      caseSensitive,
      includeCategories
    );
    
    if (score > 0) {
      results.push({
        instructionId: instruction.id,
        relevanceScore: score,
        matchedFields
      });
    }
  }
  
  // Sort by relevance score (descending) and apply limit
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const limitedResults = results.slice(0, Math.min(limit, 100));
  
  const executionTime = performance.now() - startTime;
  
  logInfo(`Search completed: ${sanitizedKeywords.length} keywords, ${limitedResults.length}/${results.length} results, ${executionTime}ms`);
  
  return {
    results: limitedResults,
    totalMatches: results.length,
    query: {
      keywords: sanitizedKeywords,
      limit: Math.min(limit, 100),
      includeCategories,
      caseSensitive
    },
    executionTimeMs: executionTime
  };
}

/**
 * MCP Handler for instructions/search
 */
export async function handleInstructionsSearch(params: SearchParams): Promise<SearchResponse> {
  try {
    // Input validation
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters: expected object');
    }
    
    if (!Array.isArray(params.keywords)) {
      throw new Error('Invalid keywords: expected array');
    }
    
    if (params.keywords.length === 0) {
      throw new Error('At least one keyword is required');
    }
    
    if (params.keywords.length > 10) {
      throw new Error('Maximum 10 keywords allowed');
    }
    
    // Validate keyword strings
    for (const keyword of params.keywords) {
      if (typeof keyword !== 'string') {
        throw new Error('All keywords must be strings');
      }
      if (keyword.trim().length === 0) {
        throw new Error('Keywords cannot be empty');
      }
      if (keyword.length > 100) {
        throw new Error('Keywords cannot exceed 100 characters');
      }
    }
    
    // Validate optional parameters
    if (params.limit !== undefined) {
      if (typeof params.limit !== 'number' || params.limit < 1 || params.limit > 100) {
        throw new Error('Limit must be a number between 1 and 100');
      }
    }
    
    if (params.includeCategories !== undefined && typeof params.includeCategories !== 'boolean') {
      throw new Error('includeCategories must be a boolean');
    }
    
    if (params.caseSensitive !== undefined && typeof params.caseSensitive !== 'boolean') {
      throw new Error('caseSensitive must be a boolean');
    }
    
    // Ensure case-insensitive search by default
    const searchParams: SearchParams = {
      keywords: params.keywords,
      limit: params.limit,
      includeCategories: params.includeCategories,
      caseSensitive: params.caseSensitive ?? false // Explicit default to false for case-insensitive search
    };
    
    return performSearch(searchParams);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown search error';
    logWarn(`Search error: ${errorMessage}`);
    throw new Error(`Search failed: ${errorMessage}`);
  }
}

// Register the handler
registerHandler('instructions/search', handleInstructionsSearch);