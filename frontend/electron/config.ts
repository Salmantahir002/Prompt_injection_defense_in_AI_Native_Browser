import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables from backend/.env if available
function loadEnv() {
  const possibleEnvPaths = [
    path.resolve(__dirname, '../../backend/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), '../backend/.env'),
    path.resolve(process.cwd(), '.env'),
  ]

  for (const envPath of possibleEnvPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim()
            let val = trimmed.slice(eqIdx + 1).trim()
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1)
            }
            if (!process.env[key]) {
              process.env[key] = val
            }
          }
        }
      } catch (err) {
        console.warn(`[config] Failed to load env from ${envPath}:`, err)
      }
    }
  }
}

loadEnv()

export const AGENT_CDP_PORT = process.env.AGENT_CDP_PORT || '9222'
export const AGENT_CDP_URL = process.env.AGENT_CDP_URL || `http://127.0.0.1:${AGENT_CDP_PORT}`

export const OPENCODE_ZEN_API_KEY = process.env.OPENCODE_ZEN_API_KEY || ''
export const OPENCODE_ZEN_BASE_URL = process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1'
export const OPENCODE_ZEN_MODEL = process.env.OPENCODE_ZEN_MODEL || 'nemotron-3-ultra-free'

export const AGENT_API_BASE_URL = process.env.AGENT_API_BASE_URL || 'http://127.0.0.1:8000/api/v1'

export const STAGEHAND_EXTENSION_PATH = path.resolve(__dirname, '../node_modules/@browserbasehq/stagehand/dist/extension')

let currentExtensionId: string | undefined = process.env.STAGEHAND_EXTENSION_ID

export function setStagehandExtensionId(id: string) {
  currentExtensionId = id
  process.env.STAGEHAND_EXTENSION_ID = id
}

export function getStagehandExtensionId(): string | undefined {
  return currentExtensionId || process.env.STAGEHAND_EXTENSION_ID
}

