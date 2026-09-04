export interface FeatureEvidence {
  instruction_density: number
  role_override_count: number
  data_exfiltration_count: number
  semantic_similarity_to_malicious_patterns: number
  top_terms: string[]
  embedding_or_vectorizer_used: string
}

const STOP_WORDS = new Set([
  'the', 'and', 'a', 'of', 'to', 'is', 'in', 'that', 'this', 'it', 'you', 'for',
  'was', 'on', 'are', 'as', 'with', 'his', 'they', 'i', 'at', 'be', 'have',
])

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

class FeatureExplanationService {
  extractFeatures(text: string, patternEvidence: Record<string, string[]>): FeatureEvidence {
    const words = text.toLowerCase().match(/\b\w{3,}\b/g) ?? []
    const wordCount = words.length

    let roleOverrideCount = 0
    let dataExfiltrationCount = 0

    for (const [category, matchedKeywords] of Object.entries(patternEvidence)) {
      const count = matchedKeywords.length
      if (category === 'override_instructions' || category === 'jailbreak_attempt') {
        roleOverrideCount += count
      } else if (category === 'data_exfiltration') {
        dataExfiltrationCount += count
      }
    }

    let instructionDensity = 0.0
    if (wordCount > 0) {
      let matchedWordsTotal = 0
      for (const matchedKeywords of Object.values(patternEvidence)) {
        for (const kw of matchedKeywords) {
          matchedWordsTotal += kw.split(' ').length
        }
      }
      instructionDensity = Math.min(1.0, matchedWordsTotal / wordCount)
    }

    const filteredWords = words.filter((w) => !STOP_WORDS.has(w) && w.length > 3)
    const freqs = new Map<string, number>()
    for (const w of filteredWords) {
      freqs.set(w, (freqs.get(w) ?? 0) + 1)
    }
    const topTerms = [...freqs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([term]) => term)

    return {
      instruction_density: round3(instructionDensity),
      role_override_count: roleOverrideCount,
      data_exfiltration_count: dataExfiltrationCount,
      semantic_similarity_to_malicious_patterns: 0.0,
      top_terms: topTerms,
      embedding_or_vectorizer_used: 'rule_based_fallback_terms',
    }
  }
}

export const featureExplanationService = new FeatureExplanationService()
