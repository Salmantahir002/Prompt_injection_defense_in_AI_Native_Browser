import { Stagehand, localBrowser, type ClientLLM } from '@browserbasehq/stagehand'
import {
  AGENT_CDP_URL,
  OPENCODE_ZEN_API_KEY,
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_MODEL,
  getStagehandExtensionId,
} from '../config.js'

/**
 * Creates an OpenAI-compatible ClientLLM adapter for Stagehand
 * using the project's OpenCode Zen configuration.
 */
export function createOpenCodeZenClientLLM(): ClientLLM {
  return {
    generate: async (params: any) => {
      const messages = params.messages.map((msg: any) => {
        let content = ''
        if (typeof msg.content === 'string') {
          content = msg.content
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .map((c: any) => (c.type === 'text' ? c.text : ''))
            .filter(Boolean)
            .join('\n')
        } else if (msg.content?.text) {
          content = msg.content.text
        }
        return {
          role: msg.role,
          content,
        }
      })

      const requestBody: Record<string, any> = {
        model: OPENCODE_ZEN_MODEL,
        messages,
        temperature: params.temperature ?? 0.1,
      }

      if (params.responseFormat?.type === 'json_schema') {
        requestBody.response_format = {
          type: 'json_object',
        }
      }

      const response = await fetch(`${OPENCODE_ZEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenCode Zen LLM Error (${response.status}): ${errorText}`)
      }

      const data = (await response.json()) as any
      const choice = data.choices?.[0]
      const text = choice?.message?.content || ''

      let structuredContent: any = undefined
      if (params.responseFormat?.schema || params.responseFormat?.type === 'json_schema') {
        try {
          structuredContent = JSON.parse(text)
        } catch {
          // If JSON parse fails, try extracting JSON substring
          const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
          if (jsonMatch) {
            structuredContent = JSON.parse(jsonMatch[0])
          }
        }
      }

      return {
        role: 'assistant',
        content: [{ type: 'text', text }],
        outputFormat: structuredContent ? 'json_schema' : 'text',
        structuredContent,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
      } as any
    },
  }
}

export class StagehandManager {
  private stagehand: Stagehand | null = null
  private isConnecting = false

  async getStagehand(): Promise<Stagehand> {
    if (this.stagehand && this.stagehand.initialized) {
      return this.stagehand
    }

    if (this.isConnecting) {
      while (this.isConnecting) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (this.stagehand) return this.stagehand
    }

    this.isConnecting = true
    try {
      const extensionId = getStagehandExtensionId()
      console.log(`[stagehand] Connecting to local browser via CDP at ${AGENT_CDP_URL} (extensionId: ${extensionId || 'auto'})...`)
      const browser = await localBrowser.connect({
        cdpUrl: AGENT_CDP_URL,
        ...(extensionId ? { extensionId } : {}),
      })

      const clientLLM = createOpenCodeZenClientLLM()

      console.log(`[stagehand] Initializing Stagehand instance with custom model...`)
      this.stagehand = await Stagehand.create({
        browser,
        model: clientLLM as any,
      })

      console.log('[stagehand] Stagehand successfully connected and initialized.')
      return this.stagehand
    } finally {
      this.isConnecting = false
    }
  }

  async close(): Promise<void> {
    if (this.stagehand) {
      try {
        await this.stagehand.close()
      } catch (err) {
        console.warn('[stagehand] Error while closing stagehand:', err)
      }
      this.stagehand = null
    }
  }
}

export const stagehandManager = new StagehandManager()
