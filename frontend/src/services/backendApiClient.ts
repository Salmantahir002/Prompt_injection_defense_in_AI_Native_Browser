import type {
  HealthResponse,
  LlmResponse,
  SecurityCheckResponse,
  SecurityEvent,
  WebpageContent,
} from '../types/securityTypes'

const API_BASE_URL = 'http://127.0.0.1:8000/api/v1'

async function requestJson<TResponse>(path: string, init?: RequestInit): Promise<TResponse> {
  let response: Response

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      ...init,
    })
  } catch {
    throw new Error('Backend is not reachable. Start Electron with npm run electron:start or run backend on port 8000.')
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Request failed with status ${response.status}`)
  }

  return response.json() as Promise<TResponse>
}

export function checkPrompt(prompt: string): Promise<SecurityCheckResponse> {
  return requestJson<SecurityCheckResponse>('/security/check-prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
}

export function checkWebpage(content: WebpageContent): Promise<SecurityCheckResponse> {
  return requestJson<SecurityCheckResponse>('/security/check-webpage', {
    method: 'POST',
    body: JSON.stringify(content),
  })
}

export async function getSecurityEvents(): Promise<SecurityEvent[]> {
  try {
    return await requestJson<SecurityEvent[]>('/security/events')
  } catch {
    return []
  }
}

export function getHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health')
}

export function chatWithLlm(prompt: string): Promise<LlmResponse> {
  return requestJson<LlmResponse>('/llm/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
}
