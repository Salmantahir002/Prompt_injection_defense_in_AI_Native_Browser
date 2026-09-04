// Port of backend/app/tests/test_text_chunking_service.py — behavioral parity.
import { describe, expect, it } from 'vitest'
import { chunkingService } from '../src/services/textChunkingService.js'

describe('text chunking', () => {
  it('short text -> single chunk', () => {
    const text = 'This is a short prompt.'
    const chunks = chunkingService.chunkText(text, 800, 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toBe(text)
    expect(chunks[0]!.chunk_id).toBe('chunk_001')
  })

  it('long text -> multiple chunks', () => {
    const chunks = chunkingService.chunkText('word '.repeat(500), 200, 50)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('chunk ids are sequential', () => {
    const chunks = chunkingService.chunkText('word '.repeat(500), 200, 50)
    chunks.forEach((chunk, i) => {
      expect(chunk.chunk_id).toBe(`chunk_${String(i + 1).padStart(3, '0')}`)
    })
  })

  it('empty text -> no chunks', () => {
    expect(chunkingService.chunkText('', 800, 100)).toHaveLength(0)
  })

  it('text exactly at chunk_size -> one chunk', () => {
    expect(chunkingService.chunkText('a'.repeat(800), 800, 100)).toHaveLength(1)
  })

  it('all chunks contain non-empty text', () => {
    for (const chunk of chunkingService.chunkText('Hello world. '.repeat(100), 200, 50)) {
      expect(chunk.text.length).toBeGreaterThan(0)
    }
  })

  it('each chunk has chunk_id and text keys', () => {
    for (const chunk of chunkingService.chunkText('Test input', 800, 100)) {
      expect(chunk).toHaveProperty('chunk_id')
      expect(chunk).toHaveProperty('text')
    }
  })
})
