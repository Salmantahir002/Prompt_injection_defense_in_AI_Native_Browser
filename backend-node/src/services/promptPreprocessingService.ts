import * as cheerio from 'cheerio'

export interface PreprocessingSummary {
  original_length: number
  normalized_length: number
  token_count: number
  steps_applied: string[]
}

export interface PreprocessResult {
  normalizedText: string
  summary: PreprocessingSummary
}

class PromptPreprocessingService {
  preprocess(text: string): PreprocessResult {
    const originalLength = text.length
    const stepsApplied: string[] = []

    let cleanedText = text
    if (text.includes('<') && text.includes('>')) {
      try {
        const $ = cheerio.load(text)
        cleanedText = $.root().text()
        stepsApplied.push('html_strip')
      } catch {
        cleanedText = text.replace(/<[^>]+>/g, '')
        stepsApplied.push('regex_html_strip')
      }
    }

    let normalizedText = cleanedText.toLowerCase()
    stepsApplied.push('lowercase')

    normalizedText = normalizedText.replace(/\s+/g, ' ').trim()
    stepsApplied.push('whitespace_normalization')

    const normalizedLength = normalizedText.length
    const tokens = normalizedText.split(' ').filter((t) => t.length > 0)
    const tokenCount = tokens.length

    return {
      normalizedText,
      summary: {
        original_length: originalLength,
        normalized_length: normalizedLength,
        token_count: tokenCount,
        steps_applied: stepsApplied,
      },
    }
  }
}

export const preprocessingService = new PromptPreprocessingService()
