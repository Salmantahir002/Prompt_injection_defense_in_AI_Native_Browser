import { useEffect, useState, useRef } from 'react'
import type { ActiveProviderInfo, ClientProviderConfig, ModelInfo } from '../types/providerTypes'
import {
  fetchProviderModels,
  getAllStoredProviders,
  getBackendActiveProvider,
  setActiveStoredProvider,
} from '../services/providerApiClient'

interface ModelSelectorProps {
  onOpenSettings: () => void
  compact?: boolean
  className?: string
}

export function ModelSelector({ onOpenSettings, compact: _compact = false, className = '' }: ModelSelectorProps) {
  const [activeInfo, setActiveInfo] = useState<ActiveProviderInfo | null>(null)
  const [savedProviders, setSavedProviders] = useState<ClientProviderConfig[]>([])
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const refreshActiveInfo = async () => {
    try {
      const [backendInfo, stored] = await Promise.all([
        getBackendActiveProvider().catch(() => null),
        getAllStoredProviders().catch(() => []),
      ])

      setSavedProviders(stored)

      if (backendInfo) {
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
            masked_key: activeStored.masked_key || '',
          })
        }
      }
    } catch {
      // Ignore
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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleToggle = async () => {
    const nextState = !isOpen
    setIsOpen(nextState)

    if (nextState && activeInfo && !activeInfo.is_fallback) {
      // Find stored provider to fetch live model list
      const currentStored = savedProviders.find((p) => p.id === activeInfo.id)
      if (currentStored && availableModels.length === 0) {
        setIsLoadingModels(true)
        try {
          const models = await fetchProviderModels(currentStored)
          setAvailableModels(models)
        } catch {
          // If live fetch fails, keep current model
        } finally {
          setIsLoadingModels(false)
        }
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
    setIsOpen(false)
    await setActiveStoredProvider(providerId, defaultModel)
    setAvailableModels([])
    refreshActiveInfo()
    window.dispatchEvent(new CustomEvent('promptguard:providers-updated'))
  }

  const providerLabel = activeInfo?.name || (activeInfo?.is_fallback ? 'OpenCode Zen (Fallback)' : 'Default Model')
  const modelLabel = activeInfo?.selected_model || 'mimo-v2.5-free'

  return (
    <div className={`model-selector-wrapper ${className}`} ref={dropdownRef}>
      <button
        type="button"
        className={`model-selector-btn ${activeInfo?.is_fallback ? 'model-selector-btn--fallback' : 'model-selector-btn--active'}`}
        onClick={handleToggle}
        title={`Active LLM: ${providerLabel} (${modelLabel})`}
        aria-expanded={isOpen}
      >
        <span className="model-selector-indicator" />
        <span className="model-selector-provider">{activeInfo?.is_fallback ? 'Fallback' : activeInfo?.name || 'AI'}</span>
        <span className="model-selector-separator">/</span>
        <span className="model-selector-model">{modelLabel}</span>
        <svg className={`model-selector-chevron ${isOpen ? 'open' : ''}`} viewBox="0 0 24 24" width="12" height="12">
          <polyline points="6 9 12 15 18 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        type="button"
        className="model-selector-settings-btn"
        onClick={onOpenSettings}
        title="Configure LLM Providers & API Keys"
        aria-label="Provider settings"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {isOpen && (
        <div className="model-selector-menu" role="menu">
          <div className="model-selector-menu-header">
            <span>Select Active Model</span>
            <button
              type="button"
              className="model-selector-manage-link"
              onClick={() => {
                setIsOpen(false)
                onOpenSettings()
              }}
            >
              Manage Providers →
            </button>
          </div>

          {/* If there are saved custom providers */}
          {savedProviders.length > 0 && (
            <div className="model-selector-section">
              <div className="model-selector-section-title">Saved Providers</div>
              {savedProviders.map((p) => {
                const isSelected = activeInfo?.id === p.id && !activeInfo?.is_fallback
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`model-selector-item ${isSelected ? 'model-selector-item--selected' : ''}`}
                    onClick={() => handleSelectProvider(p.id, p.selected_model)}
                  >
                    <div className="model-selector-item-main">
                      <span className="model-selector-item-name">{p.name}</span>
                      <span className="model-selector-item-sub">{p.selected_model || 'No model chosen'}</span>
                    </div>
                    {isSelected && <span className="model-selector-checkmark">✓</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* Model options for active provider */}
          {availableModels.length > 0 && (
            <div className="model-selector-section">
              <div className="model-selector-section-title">Available Models ({activeInfo?.name})</div>
              <div className="model-selector-scroll">
                {availableModels.map((m) => {
                  const isSelected = activeInfo?.selected_model === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`model-selector-item ${isSelected ? 'model-selector-item--selected' : ''}`}
                      onClick={() => handleSelectModel(m.id)}
                    >
                      <div className="model-selector-item-main">
                        <span className="model-selector-item-name">{m.name}</span>
                        {m.id !== m.name && <span className="model-selector-item-sub">{m.id}</span>}
                      </div>
                      {isSelected && <span className="model-selector-checkmark">✓</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {isLoadingModels && (
            <div className="model-selector-loading">
              <span className="dot-pulse"><span /><span /><span /></span>
              <span>Fetching live models...</span>
            </div>
          )}

          {/* Default fallback info */}
          <div className="model-selector-footer">
            <button
              type="button"
              className={`model-selector-item model-selector-fallback ${activeInfo?.is_fallback ? 'model-selector-item--selected' : ''}`}
              onClick={() => handleSelectProvider('', undefined)}
            >
              <div className="model-selector-item-main">
                <span className="model-selector-item-name">Developer Fallback (.env)</span>
                <span className="model-selector-item-sub">OpenCode Zen (mimo-v2.5-free)</span>
              </div>
              {activeInfo?.is_fallback && <span className="model-selector-checkmark">✓</span>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
