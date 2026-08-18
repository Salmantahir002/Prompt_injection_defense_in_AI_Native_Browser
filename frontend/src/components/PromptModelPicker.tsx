import { useEffect, useState, useRef, useMemo } from 'react'
import type { ActiveProviderInfo, ClientProviderConfig, ModelInfo } from '../types/providerTypes'
import {
  fetchProviderModels,
  getAllStoredProviders,
  getBackendActiveProvider,
  setActiveStoredProvider,
} from '../services/providerApiClient'
import { getProviderLogo } from './ProviderIcons'

interface PromptModelPickerProps {
  onOpenSettings?: () => void
  className?: string
}

// Curated default OpenCode Zen / Fallback models
const DEFAULT_FALLBACK_MODELS: ModelInfo[] = [
  { id: 'deepseek-v4-flash-free', name: 'DeepSeek V4 Flash Free' },
  { id: 'hy3-free', name: 'Hy3 Free' },
  { id: 'laguna-s-2.1-free', name: 'Laguna S 2.1 Free' },
  { id: 'mimo-v2.5-free', name: 'MiMo V2.5 Free' },
  { id: 'nemotron-3.5-lightning-free', name: 'Nemotron 3.5 Lightning Free' },
  { id: 'nemotron-3-ultra-free', name: 'Nemotron 3 Ultra Free' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet' },
  { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
]

function formatModelName(modelId: string, modelName?: string): { title: string; isFree: boolean } {
  const raw = modelName && modelName.trim() ? modelName : modelId
  const isFree = raw.toLowerCase().includes('free') || modelId.toLowerCase().includes('free')
  
  let title = raw
  if (title === 'mimo-v2.5-free') title = 'MiMo V2.5 Free'
  else if (title === 'deepseek-v4-flash-free') title = 'DeepSeek V4 Flash Free'
  else if (title === 'hy3-free') title = 'Hy3 Free'
  else if (title === 'laguna-s-2.1-free') title = 'Laguna S 2.1 Free'
  else if (title === 'nemotron-3.5-lightning-free') title = 'Nemotron 3.5 Lightning Free'
  else if (title === 'nemotron-3-ultra-free') title = 'Nemotron 3 Ultra Free'
  else if (title === 'gemini-2.5-flash') title = 'Gemini 2.5 Flash'
  else if (title === 'gemini-2.5-flash-lite') title = 'Gemini 2.5 Flash Lite'
  else if (title === 'gemini-2.5-pro') title = 'Gemini 2.5 Pro'
  else if (title === 'gemini-2.0-flash') title = 'Gemini 2.0 Flash'
  else if (title === 'gemini-1.5-flash') title = 'Gemini 1.5 Flash'
  else if (title === 'gemini-1.5-pro') title = 'Gemini 1.5 Pro'
  else if (title.startsWith('@cf/')) {
    if (modelName && modelName !== modelId) {
      title = modelName
    } else {
      const parts = title.replace('@cf/', '').split('/')
      title = parts[parts.length - 1]
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }
  
  return { title, isFree }
}

export function PromptModelPicker({ onOpenSettings, className = '' }: PromptModelPickerProps) {
  const [activeInfo, setActiveInfo] = useState<ActiveProviderInfo | null>(null)
  const [savedProviders, setSavedProviders] = useState<ClientProviderConfig[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  const refreshActiveInfo = async () => {
    try {
      const [backendInfo, stored] = await Promise.all([
        getBackendActiveProvider().catch(() => null),
        getAllStoredProviders().catch(() => []),
      ])

      setSavedProviders(stored)

      if (backendInfo && backendInfo.is_active && !backendInfo.is_fallback) {
        setActiveInfo(backendInfo)
      } else {
        const activeStored = stored.find((p) => p.is_active)
        if (activeStored) {
          setActiveInfo({
            id: activeStored.id,
            name: activeStored.name,
            provider_type: activeStored.provider_type,
            base_url: activeStored.base_url,
            is_active: true,
            is_fallback: false,
            selected_model: activeStored.selected_model,
            models: activeStored.models,
            masked_key: activeStored.masked_key || '',
          })
        } else if (backendInfo) {
          setActiveInfo(backendInfo)
        } else {
          setActiveInfo({
            id: 'opencode',
            name: 'OpenCode Zen',
            provider_type: 'openai_compatible',
            is_active: true,
            is_fallback: true,
            selected_model: 'nemotron-3-ultra-free',
            masked_key: '',
          })
        }
      }
    } catch {
      // Graceful fallback
    }
  }

  useEffect(() => {
    refreshActiveInfo()
    const handleStorage = () => refreshActiveInfo()
    window.addEventListener('promptguard:providers-updated', handleStorage)
    window.addEventListener('focus', handleStorage)
    return () => {
      window.removeEventListener('promptguard:providers-updated', handleStorage)
      window.removeEventListener('focus', handleStorage)
    }
  }, [])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Get current active provider
  const currentProvider = savedProviders.find((p) => p.id === activeInfo?.id)

  // Compute model list to display
  const modelList: ModelInfo[] = useMemo(() => {
    if (currentProvider?.models && currentProvider.models.length > 0) {
      return currentProvider.models
    }
    if (activeInfo?.models && activeInfo.models.length > 0) {
      return activeInfo.models
    }
    const id = (activeInfo?.id || currentProvider?.id || '').toLowerCase()
    if (id.includes('gemini') || id.includes('google')) {
      return [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      ]
    }
    if (id.includes('cloudflare') || id.includes('workers') || id.includes('cf')) {
      return [
        { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct' },
        { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct' },
        { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct' },
        { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B Instruct' },
        { id: '@cf/meta/llama-3.2-1b-instruct', name: 'Llama 3.2 1B Instruct' },
        { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill Qwen 32B' },
        { id: '@cf/qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B Instruct' },
        { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B Instruct' },
        { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'Mistral 7B Instruct' },
        { id: '@cf/google/gemma-2-27b-it', name: 'Gemma 2 27B IT' },
      ]
    }
    if (id.includes('anthropic') || id.includes('claude')) {
      return [
        { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
      ]
    }
    if (id.includes('openai') || id.includes('gpt')) {
      return [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4.5-preview', name: 'GPT-4.5 Preview' },
        { id: 'o3-mini', name: 'o3-mini' },
        { id: 'o1', name: 'o1' },
      ]
    }
    if (activeInfo?.id === 'opencode' || activeInfo?.id === 'opencode_zen' || activeInfo?.is_fallback || !activeInfo?.id) {
      return DEFAULT_FALLBACK_MODELS
    }
    if (activeInfo?.selected_model) {
      return [{ id: activeInfo.selected_model, name: activeInfo.selected_model }]
    }
    return DEFAULT_FALLBACK_MODELS
  }, [currentProvider, activeInfo])

  const handleToggle = async () => {
    const nextState = !isOpen
    setIsOpen(nextState)
    setSearchTerm('')

    // If opening and provider has credentials but no models yet, live-fetch
    if (nextState && currentProvider && (!currentProvider.models || currentProvider.models.length === 0) && currentProvider.has_key) {
      setIsLoadingModels(true)
      try {
        const fetched = await fetchProviderModels(currentProvider)
        if (fetched && fetched.length > 0) {
          currentProvider.models = fetched
          setSavedProviders([...savedProviders])
        }
      } catch {
        // Silently fallback
      } finally {
        setIsLoadingModels(false)
      }
    }
  }

  const handleSelectModel = async (modelId: string) => {
    if (!activeInfo) return
    setActiveInfo((prev) => (prev ? { ...prev, selected_model: modelId } : null))
    setIsOpen(false)

    await setActiveStoredProvider(activeInfo.id, modelId)
    window.dispatchEvent(new CustomEvent('promptguard:providers-updated'))
  }

  const handleSelectProvider = async (providerId: string, defaultModel?: string) => {
    await setActiveStoredProvider(providerId, defaultModel)
    setIsOpen(false)
    refreshActiveInfo()
    window.dispatchEvent(new CustomEvent('promptguard:providers-updated'))
  }

  // Active provider label & active model label
  const providerId = activeInfo?.id || 'opencode'
  const providerName = activeInfo?.name || (activeInfo?.is_fallback ? 'OpenCode Zen' : 'AI Provider')
  const currentModelId = activeInfo?.selected_model || (modelList.length > 0 ? modelList[0].id : 'nemotron-3-ultra-free')
  
  const currentModelObj = modelList.find((m) => m.id === currentModelId)
  const formattedCurrent = formatModelName(currentModelId, currentModelObj?.name)

  const filteredModels = searchTerm.trim()
    ? modelList.filter(
        (m) =>
          m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.id.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : modelList

  return (
    <div className={`prompt-model-picker-wrapper ${className}`} ref={pickerRef}>
      {/* Trigger Button: Only Logo + Model Name + Chevron (Matching Reference Image 4) */}
      <button
        type="button"
        className="prompt-model-btn"
        onClick={handleToggle}
        title={`Active Model: ${providerName} - ${formattedCurrent.title}`}
        aria-expanded={isOpen}
      >
        <span className="prompt-model-btn-logo">
          {getProviderLogo(providerId, 16)}
        </span>
        <span className="prompt-model-btn-name">
          {formattedCurrent.title}
        </span>
        <svg
          className={`prompt-model-btn-chevron ${isOpen ? 'open' : ''}`}
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Upward Popover Dropdown (Matching Reference Image 5) */}
      {isOpen && (
        <div className="prompt-model-menu" role="menu">
          {/* Header with Provider Name */}
          <div className="prompt-model-menu-header">
            <div className="prompt-model-provider-title">
              <span className="prompt-model-header-logo">{getProviderLogo(providerId, 15)}</span>
              <span className="prompt-model-header-text">{providerName}</span>
            </div>
          </div>

          {/* Quick Search if model count is high */}
          {modelList.length > 7 ? (
            <div className="prompt-model-search-box">
              <input
                type="text"
                className="prompt-model-search-input"
                placeholder="Search models..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
            </div>
          ) : null}

          {/* Models List for the Active Provider (Matching Reference Image 5) */}
          <div className="prompt-model-list">
            {isLoadingModels ? (
              <div className="prompt-model-loading">
                <span className="dot-pulse"><span /><span /><span /></span>
                <span>Fetching live models...</span>
              </div>
            ) : null}

            {filteredModels.map((model) => {
              const isSelected = currentModelId === model.id
              const { title, isFree } = formatModelName(model.id, model.name)
              return (
                <button
                  key={model.id}
                  type="button"
                  className={`prompt-model-item ${isSelected ? 'prompt-model-item--active' : ''}`}
                  onClick={() => handleSelectModel(model.id)}
                  role="menuitem"
                >
                  <div className="prompt-model-item-left">
                    <span className="prompt-model-item-title">{title}</span>
                    {isFree ? (
                      <span className="prompt-model-free-badge">Free</span>
                    ) : null}
                  </div>
                  {isSelected && (
                    <span className="prompt-model-checkmark">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}

            {filteredModels.length === 0 && !isLoadingModels ? (
              <div className="prompt-model-empty">No matching models found</div>
            ) : null}
          </div>

          {/* If there are other configured providers, offer quick switch */}
          {savedProviders.length > 1 && (
            <div className="prompt-model-providers-section">
              <div className="prompt-model-section-label">Other Connected Providers</div>
              {savedProviders
                .filter((p) => p.id !== activeInfo?.id)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="prompt-model-provider-switch-item"
                    onClick={() => handleSelectProvider(p.id, p.selected_model)}
                  >
                    <span className="prompt-model-switch-logo">{getProviderLogo(p.id, 14)}</span>
                    <span className="prompt-model-switch-name">{p.name}</span>
                    <span className="prompt-model-switch-count">
                      {p.models?.length ? `${p.models.length} models` : 'Ready'}
                    </span>
                  </button>
                ))}
            </div>
          )}

          {/* Footer with Manage Providers */}
          {onOpenSettings && (
            <div className="prompt-model-footer">
              <button
                type="button"
                className="prompt-model-manage-btn"
                onClick={() => {
                  setIsOpen(false)
                  onOpenSettings()
                }}
              >
                <span>Manage Providers & Keys</span>
                <span className="prompt-model-manage-arrow">→</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
