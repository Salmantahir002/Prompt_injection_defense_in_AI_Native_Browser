import zlib from 'node:zlib'

/**
 * Extract plain text from .docx (Word) file buffer using standard node:zlib.
 * A .docx file is a standard PKZip archive containing 'word/document.xml'.
 */
export function extractTextFromDocx(buffer: Buffer): string {
  let offset = 0
  const chunks: string[] = []

  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset++
      continue
    }

    const compMethod = buffer.readUInt16LE(offset + 8)
    const compSize = buffer.readUInt32LE(offset + 18)
    const nameLen = buffer.readUInt16LE(offset + 26)
    const extraLen = buffer.readUInt16LE(offset + 28)

    const nameStart = offset + 30
    const nameEnd = nameStart + nameLen
    if (nameEnd > buffer.length) break

    const fileName = buffer.toString('utf8', nameStart, nameEnd)
    const dataStart = nameEnd + extraLen
    const dataEnd = dataStart + compSize

    if (dataEnd > buffer.length) break

    if (
      fileName === 'word/document.xml' ||
      fileName.startsWith('word/header') ||
      fileName.startsWith('word/footer')
    ) {
      try {
        const raw = buffer.subarray(dataStart, dataEnd)
        const xml =
          compMethod === 8 ? zlib.inflateRawSync(raw).toString('utf8') : raw.toString('utf8')

        const text = xml
          .replace(/<w:p[ >]/gi, '\n')
          .replace(/<w:br[ >]/gi, '\n')
          .replace(/<w:tab[ >]/gi, '\t')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .trim()

        if (text) chunks.push(text)
      } catch {
        // Continue parsing other parts
      }
    }

    offset = dataEnd
  }

  return chunks.join('\n\n').trim()
}

/**
 * Extract plain text from PDF buffer using standard stream decoding and zlib decompression.
 */
export function extractTextFromPdf(buffer: Buffer): string {
  const textChunks: string[] = []
  const str = buffer.toString('binary')

  let streamIdx = 0
  while ((streamIdx = str.indexOf('stream', streamIdx)) !== -1) {
    const streamStart = streamIdx + 6
    let dataStart = streamStart
    if (buffer[dataStart] === 0x0d && buffer[dataStart + 1] === 0x0a) dataStart += 2
    else if (buffer[dataStart] === 0x0a || buffer[dataStart] === 0x0d) dataStart += 1

    const endIdx = str.indexOf('endstream', dataStart)
    if (endIdx === -1) break

    const streamData = buffer.subarray(dataStart, endIdx)
    let decompressed: string | null = null

    try {
      decompressed = zlib.inflateSync(streamData).toString('utf8')
    } catch {
      try {
        decompressed = zlib.inflateRawSync(streamData).toString('utf8')
      } catch {
        decompressed = streamData.toString('utf8')
      }
    }

    if (decompressed) {
      const tjMatches = decompressed.match(/\((.*?)\)\s*Tj/g)
      if (tjMatches) {
        for (const m of tjMatches) {
          const t = m.replace(/^\(/, '').replace(/\)\s*Tj$/, '').trim()
          if (t) textChunks.push(t)
        }
      }
      const tjArrayMatches = decompressed.match(/\[(.*?)\]\s*TJ/g)
      if (tjArrayMatches) {
        for (const m of tjArrayMatches) {
          const innerStrings = m.match(/\((.*?)\)/g)
          if (innerStrings) {
            const combined = innerStrings.map((s) => s.slice(1, -1)).join('')
            if (combined.trim()) textChunks.push(combined.trim())
          }
        }
      }
    }

    streamIdx = endIdx + 9
  }

  return textChunks.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Universal document extractor from base64 or text data URL.
 */
export function extractDocumentContent(
  dataUrlOrBase64: string,
  filename: string,
  mimeType?: string,
): string {
  const base64 = dataUrlOrBase64.replace(/^data:[^;]+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  const ext = (filename.split('.').pop() || '').toLowerCase()

  if (ext === 'docx' || mimeType?.includes('wordprocessingml')) {
    const docxText = extractTextFromDocx(buffer)
    if (docxText) return docxText
  }

  if (ext === 'pdf' || mimeType?.includes('pdf')) {
    const pdfText = extractTextFromPdf(buffer)
    if (pdfText) return pdfText
  }

  // Plain text / source code / markdown / json / csv / etc.
  try {
    const utf8Text = buffer.toString('utf8')
    let nullCount = 0
    for (let i = 0; i < Math.min(utf8Text.length, 500); i++) {
      if (utf8Text.charCodeAt(i) === 0) nullCount++
    }
    if (nullCount === 0) {
      return utf8Text
    }
  } catch {
    // ignore
  }

  return ''
}
