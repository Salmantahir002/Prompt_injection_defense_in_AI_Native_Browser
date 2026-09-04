export interface TextChunk {
  chunk_id: string
  text: string
}

class TextChunkingService {
  chunkText(text: string, chunkSize: number, overlap: number): TextChunk[] {
    if (!text) return []

    let effectiveChunkSize = chunkSize
    let effectiveOverlap = overlap
    if (effectiveChunkSize <= 0) effectiveChunkSize = 800
    if (effectiveOverlap < 0 || effectiveOverlap >= effectiveChunkSize) effectiveOverlap = 100

    const chunks: TextChunk[] = []
    const textLen = text.length
    let start = 0
    let chunkIdx = 1

    while (start < textLen) {
      const end = Math.min(start + effectiveChunkSize, textLen)
      const chunkContent = text.slice(start, end)

      chunks.push({
        chunk_id: `chunk_${String(chunkIdx).padStart(3, '0')}`,
        text: chunkContent,
      })

      chunkIdx += 1

      if (end >= textLen) break

      start += effectiveChunkSize - effectiveOverlap
    }

    return chunks
  }
}

export const chunkingService = new TextChunkingService()
