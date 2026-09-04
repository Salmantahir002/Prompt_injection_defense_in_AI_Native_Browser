import { config as loadDotenv } from 'dotenv'

loadDotenv()

function parseCorsOrigins(raw: string | undefined): string[] {
  const value = raw ?? 'http://localhost:5173'
  if (value.trim().startsWith('[')) {
    return JSON.parse(value) as string[]
  }
  return value.split(',').map((origin) => origin.trim()).filter(Boolean)
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isNaN(parsed) ? fallback : parsed
}

export interface Settings {
  APP_NAME: string
  APP_ENV: 'development' | 'production' | string
  API_V1_PREFIX: string
  PORT: number
  CORS_ALLOWED_ORIGINS: string[]
  MODEL_DIR: string
  CLASSIFIER_THRESHOLD: number
  DEFAULT_CHUNK_SIZE: number
  DEFAULT_CHUNK_OVERLAP: number
  AGENT_MIN_CONFIDENCE: number
}

export const settings: Settings = {
  APP_NAME: process.env.APP_NAME ?? 'Prompt Injection Defense Browser Backend',
  APP_ENV: process.env.APP_ENV ?? 'development',
  API_V1_PREFIX: process.env.API_V1_PREFIX ?? '/api/v1',
  // Not present in the Python Settings (uvicorn.run() hardcodes 8000 in run_backend.py) —
  // the Node entrypoint needs a configurable bind port, so it's added here. Defaults to 8000
  // to match the existing frontend contract (all three HTTP clients hardcode 127.0.0.1:8000).
  PORT: parseNumber(process.env.PORT, 8000),
  CORS_ALLOWED_ORIGINS: parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS),
  MODEL_DIR: process.env.MODEL_DIR ?? 'ml_models/prompt_injection_model',
  CLASSIFIER_THRESHOLD: parseNumber(process.env.CLASSIFIER_THRESHOLD, 0.7),
  DEFAULT_CHUNK_SIZE: parseNumber(process.env.DEFAULT_CHUNK_SIZE, 800),
  DEFAULT_CHUNK_OVERLAP: parseNumber(process.env.DEFAULT_CHUNK_OVERLAP, 100),
  AGENT_MIN_CONFIDENCE: parseNumber(process.env.AGENT_MIN_CONFIDENCE, 0.6),
}
