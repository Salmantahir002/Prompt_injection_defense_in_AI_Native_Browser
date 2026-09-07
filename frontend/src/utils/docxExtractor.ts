/**
 * Browser-native zero-dependency .docx text extractor using standard Web DecompressionStream.
 * A .docx file is a standard PKZip archive containing 'word/document.xml'.
 */
export async function extractDocxTextInBrowser(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const view = new DataView(arrayBuffer)
    const bytes = new Uint8Array(arrayBuffer)
    let offset = 0
    const textChunks: string[] = []

    while (offset + 30 <= bytes.length) {
      if (view.getUint32(offset, true) !== 0x04034b50) {
        offset++
        continue
      }

      const compMethod = view.getUint16(offset + 8, true)
      const compSize = view.getUint32(offset + 18, true)
      const nameLen = view.getUint16(offset + 26, true)
      const extraLen = view.getUint16(offset + 28, true)

      const nameStart = offset + 30
      const nameEnd = nameStart + nameLen
      if (nameEnd > bytes.length) break

      const decoder = new TextDecoder('utf-8')
      const fileName = decoder.decode(bytes.subarray(nameStart, nameEnd))
      const dataStart = nameEnd + extraLen
      const dataEnd = dataStart + compSize

      if (dataEnd > bytes.length) break

      if (
        fileName === 'word/document.xml' ||
        fileName.startsWith('word/header') ||
        fileName.startsWith('word/footer')
      ) {
        const chunk = bytes.subarray(dataStart, dataEnd)
        let xml = ''

        if (compMethod === 8 && typeof DecompressionStream !== 'undefined') {
          try {
            const ds = new DecompressionStream('deflate-raw')
            const stream = new Response(new Blob([chunk]).stream().pipeThrough(ds))
            xml = await stream.text()
          } catch {
            // fallback
          }
        } else if (compMethod === 0) {
          xml = decoder.decode(chunk)
        }

        if (xml) {
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
          if (text) textChunks.push(text)
        }
      }

      offset = dataEnd
    }

    return textChunks.join('\n\n').trim()
  } catch (err) {
    console.warn('Browser docx extraction skipped:', err)
    return ''
  }
}
