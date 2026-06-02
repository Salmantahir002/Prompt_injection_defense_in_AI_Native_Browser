const PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//
const LOCALHOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/.*)?$/i

function shouldTreatAsSearch(input: string): boolean {
  if (input.includes(' ') || input.includes('\t')) {
    return true
  }

  return !input.includes('.') && !LOCALHOST_PATTERN.test(input)
}

export function normalizeUrl(input: string): string {
  const trimmedInput = input.trim()

  if (!trimmedInput) {
    throw new Error('Enter a URL')
  }

  if (!PROTOCOL_PATTERN.test(trimmedInput) && shouldTreatAsSearch(trimmedInput)) {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmedInput)}`
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
