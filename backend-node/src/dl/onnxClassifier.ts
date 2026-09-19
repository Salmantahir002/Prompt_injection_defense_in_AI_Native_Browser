// Runs text chunks through Llama Prompt Guard 2 and returns a per-chunk
// malicious probability. promptClassifierService is the only caller; it
// combines this verdict with the rule-based detector's.
import { chunkingService } from '../services/textChunkingService.js'
import { logger } from '../core/logging.js'
import { DL_MAX_TOKENS, loadDlClassifier, type DlPipeline } from './modelLoader.js'

export interface DlVerdict {
  label: 'BENIGN' | 'MALICIOUS'
  /** Probability mass on the MALICIOUS class, 0–1. */
  maliciousScore: number
}

// Character size used to re-split a chunk that overflows the 512-token window.
// The shared 800-char chunker is tuned for the rule-based detector and stays
// as-is; this only applies to the minority of chunks that overflow.
const SUBCHUNK_CHARS = 400
// Below this, halving further stops helping and only multiplies inference cost.
const MIN_SUBCHUNK_CHARS = 100
// Cap on sequences per forward pass. Everything in a batch is padded to the
// longest member, so one unbounded batch over a 14-channel page scan would
// allocate activations for hundreds of 512-token sequences at once.
const MAX_BATCH = 16

const BENIGN_VERDICT: DlVerdict = { label: 'BENIGN', maliciousScore: 0 }

/**
 * Classifies every chunk in one batched pass.
 *
 * Returns `null` when no model is loaded (caller stays on rule-based only).
 * Throws on inference failure — the caller must fail closed rather than read a
 * thrown error as "benign".
 */
export async function classifyChunksDl(texts: readonly string[]): Promise<DlVerdict[] | null> {
  const classifier = await loadDlClassifier()
  if (!classifier) return null

  // Expand each input into one or more sequences that fit the token window,
  // remembering which expanded sequences belong to which input.
  const sequences: string[] = []
  const spans: Array<{ start: number; end: number }> = []
  for (const [index, text] of texts.entries()) {
    const start = sequences.length
    if (text.trim()) {
      sequences.push(...splitToTokenBudget(text, classifier.tokenizer, index))
    }
    spans.push({ start, end: sequences.length })
  }

  const scores = await scoreAll(classifier, sequences)

  // Any sub-chunk malicious → the whole chunk is malicious. Take the maximum
  // so a payload isolated in one sub-chunk is not averaged away.
  return spans.map(({ start, end }) => {
    if (start === end) return BENIGN_VERDICT
    const maliciousScore = Math.max(...scores.slice(start, end))
    return { label: maliciousScore >= 0.5 ? 'MALICIOUS' : 'BENIGN', maliciousScore }
  })
}

async function scoreAll(classifier: DlPipeline, sequences: string[]): Promise<number[]> {
  const scores: number[] = []
  for (let offset = 0; offset < sequences.length; offset += MAX_BATCH) {
    const batch = sequences.slice(offset, offset + MAX_BATCH)
    const results = await classifier(batch, { top_k: 2 })
    for (const entries of results) {
      scores.push(maliciousScoreOf(entries))
    }
  }
  return scores
}

/**
 * Selects the MALICIOUS score by label string, never by array position.
 *
 * transformers.js returns the two class scores sorted by score descending, so
 * their order flips with the verdict. Reading index 1 would report BENIGN's
 * probability as the threat score on exactly the inputs that matter — an
 * inversion that looks like a working gate while passing every attack through.
 */
function maliciousScoreOf(entries: ReadonlyArray<{ label: string; score: number }>): number {
  const malicious = entries.find((entry) => entry.label === 'MALICIOUS')
  if (!malicious) {
    throw new Error(
      `Prompt Guard output has no MALICIOUS label (got: ${entries.map((e) => e.label).join(', ') || 'nothing'}). ` +
        'The model config.json id2label mapping is not the expected {0: BENIGN, 1: MALICIOUS}.',
    )
  }
  return malicious.score
}

/**
 * Splits `text` into pieces that each fit inside the 512-token window.
 *
 * 800 characters of English is well under 512 tokens, but token-dense scripts
 * among Prompt Guard's training languages (Hindi, Thai) can exceed it inside a
 * single chunk. Left to the tokenizer, the tail would be silently truncated —
 * precisely where an attacker would place a payload if they assumed the
 * defender only tested in English. Splitting instead keeps full coverage
 * without shrinking the chunk size for content that never needs it.
 */
function splitToTokenBudget(
  text: string,
  tokenizer: DlPipeline['tokenizer'],
  chunkIndex: number,
): string[] {
  const tokenCount = tokenizer.encode(text).length
  if (tokenCount <= DL_MAX_TOKENS) return [text]

  // Chunk index only — never the content, which would write attacker-supplied
  // text verbatim into the logs.
  logger.warn(
    { chunk_index: chunkIndex, token_count: tokenCount, token_budget: DL_MAX_TOKENS },
    'Chunk exceeds the classifier token window; re-splitting it so no part goes unscanned.',
  )

  let size = SUBCHUNK_CHARS
  let pieces = splitAt(text, size)
  while (size > MIN_SUBCHUNK_CHARS && pieces.some((piece) => tokenizer.encode(piece).length > DL_MAX_TOKENS)) {
    size = Math.max(MIN_SUBCHUNK_CHARS, Math.floor(size / 2))
    pieces = splitAt(text, size)
  }
  return pieces
}

function splitAt(text: string, size: number): string[] {
  // Overlap keeps an injection phrase that straddles a sub-chunk boundary
  // intact in at least one piece.
  return chunkingService.chunkText(text, size, Math.floor(size / 4)).map((chunk) => chunk.text)
}
