// Port of backend/app/tests/test_analysis_details_schema.py.
// Pydantic applies field defaults on construction; TypeBox Value.Check does not,
// so ChunkResult objects here are built complete (source + matched_evidence) —
// exactly as analyzeText() in security.routes.ts produces them.
import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import {
  AnalysisDetailsSchema,
  ChunkResultSchema,
} from '../src/schemas/analysisDetails.schemas.js'
import {
  ChunkingInfoSchema,
  FeatureEvidenceSchema,
  PreprocessingSummarySchema,
} from '../src/schemas/analysisDetails.schemas.js'

const benignChunk = {
  chunk_id: 'chunk_001',
  source: 'prompt',
  label: 'benign' as const,
  confidence: 0.94,
  risk_level: 'low' as const,
  matched_patterns: [] as string[],
  reason: 'No suspicious patterns.',
  excerpt: 'This is a safe chunk.',
  matched_evidence: [] as string[],
}

it('preprocessing summary validates', () => {
  expect(
    Value.Check(PreprocessingSummarySchema, {
      original_length: 120,
      normalized_length: 110,
      token_count: 18,
      steps_applied: ['lowercase', 'whitespace_normalization'],
    }),
  ).toBe(true)
})

it('chunking info validates', () => {
  expect(
    Value.Check(ChunkingInfoSchema, {
      chunk_count: 3,
      chunk_size: 800,
      overlap: 100,
      highest_risk_chunk_id: 'chunk_002',
    }),
  ).toBe(true)
})

it('benign and malicious chunk results validate', () => {
  expect(Value.Check(ChunkResultSchema, benignChunk)).toBe(true)
  expect(
    Value.Check(ChunkResultSchema, {
      ...benignChunk,
      chunk_id: 'chunk_002',
      label: 'malicious',
      confidence: 0.92,
      risk_level: 'high',
      matched_patterns: ['override_instructions'],
      reason: 'Matched override indicators.',
      excerpt: 'Ignore previous...',
      matched_evidence: ['ignore previous'],
    }),
  ).toBe(true)
})

it('chunk result missing a required field fails', () => {
  const { reason, ...incomplete } = benignChunk
  void reason
  expect(Value.Check(ChunkResultSchema, incomplete)).toBe(false)
})

it('feature evidence validates', () => {
  expect(
    Value.Check(FeatureEvidenceSchema, {
      top_terms: ['ignore', 'instructions'],
      instruction_density: 0.35,
      role_override_count: 2,
      data_exfiltration_count: 0,
      semantic_similarity_to_malicious_patterns: 0.08,
      embedding_or_vectorizer_used: 'rule_based_fallback_terms',
    }),
  ).toBe(true)
})

it('full AnalysisDetails validates', () => {
  const details = {
    classifier_mode: 'rule_based_fallback' as const,
    threshold_used: 0.7,
    preprocessing: {
      original_length: 100,
      normalized_length: 95,
      token_count: 15,
      steps_applied: ['lowercase'],
    },
    chunking: {
      chunk_count: 1,
      chunk_size: 800,
      overlap: 100,
      highest_risk_chunk_id: 'chunk_001',
    },
    feature_evidence: {
      top_terms: ['hello', 'world'],
      instruction_density: 0.0,
      role_override_count: 0,
      data_exfiltration_count: 0,
      semantic_similarity_to_malicious_patterns: 0.0,
      embedding_or_vectorizer_used: 'rule_based_fallback_terms',
    },
    chunk_results: [benignChunk],
    final_rationale: 'The input is safe because no chunk crossed the malicious threshold.',
  }
  expect(Value.Check(AnalysisDetailsSchema, details)).toBe(true)
  expect(details.chunk_results).toHaveLength(1)
})
