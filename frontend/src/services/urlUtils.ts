const PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//

export function normalizeUrl(input: string): string {
  const trimmedInput = input.trim()

  if (!trimmedInput) {
    throw new Error('Enter a URL')
  }

  const urlWithProtocol = PROTOCOL_PATTERN.test(trimmedInput)
    ? trimmedInput
    : `https://${trimmedInput}`

  if (!isValidUrl(urlWithProtocol)) {
    throw new Error('Enter a valid URL')
  }

  return urlWithProtocol
}

export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
  } catch {
    return false
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
