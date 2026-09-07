export interface ModelCapabilities {
  supportsImages: boolean
  supportsFiles: boolean
  modelId: string
  modelName: string
  providerId?: string
  warningReason?: string
}

/**
 * Determine whether a selected model supports images (vision) and file/document inputs.
 * Google Gemini, Anthropic Claude 3/3.5/3.7, and OpenAI GPT-4o/GPT-4.5 are multimodal.
 * DeepSeek, Llama text, Qwen text, Mistral, Gemma, and NVIDIA/OpenCode text models are text-only.
 */
export function getModelCapabilities(
  modelId?: string | null,
  providerId?: string | null,
  modelDisplayName?: string | null,
): ModelCapabilities {
  const rawId = (modelId || '').toLowerCase().trim()
  const rawProvider = (providerId || '').toLowerCase().trim()
  const displayName = modelDisplayName || modelId || 'Selected Model'

  // If no provider or no model is selected
  if (!rawId && !rawProvider) {
    return {
      supportsImages: false,
      supportsFiles: false,
      modelId: '',
      modelName: 'No Model Connected',
      warningReason: 'No AI provider is connected. Please connect a provider in Settings to upload images or files.',
    }
  }

  // 1. Google Gemini (natively multimodal: images, audio, video, PDF, text documents)
  if (rawId.includes('gemini') || rawProvider.includes('gemini') || rawProvider.includes('google')) {
    return {
      supportsImages: true,
      supportsFiles: true,
      modelId: rawId,
      modelName: displayName,
    }
  }

  // 2. Anthropic Claude (Claude 3, 3.5, 3.7 support vision and documents/PDF)
  if (
    rawId.includes('claude-3') ||
    rawId.includes('claude-4') ||
    rawId.includes('claude-sonnet') ||
    rawId.includes('claude-opus') ||
    rawId.includes('claude-haiku') ||
    (rawProvider.includes('anthropic') && !rawId.includes('claude-2') && !rawId.includes('claude-1'))
  ) {
    return {
      supportsImages: true,
      supportsFiles: true,
      modelId: rawId,
      modelName: displayName,
    }
  }

  // 3. OpenAI GPT-4o, GPT-4.5, GPT-4 Turbo, GPT-5, o1
  // Note: o3-mini and o1-mini and gpt-3.5 are text-only.
  const isReasoningMini = rawId.includes('o3-mini') || rawId.includes('o1-mini')
  const isLegacyGpt = rawId.includes('gpt-3.5') || rawId.includes('davinci') || rawId.includes('babbage')
  if (
    !isReasoningMini &&
    !isLegacyGpt &&
    (rawId.includes('gpt-4o') ||
      rawId.includes('gpt-4.5') ||
      rawId.includes('gpt-5') ||
      rawId.includes('gpt-4-turbo') ||
      rawId.includes('o1') ||
      rawId.includes('sol'))
  ) {
    return {
      supportsImages: true,
      supportsFiles: true,
      modelId: rawId,
      modelName: displayName,
    }
  }

  // 4. Models explicitly indicating vision or VL (e.g. Qwen-VL, Llama-3.2-Vision, Pixtral)
  if (
    rawId.includes('vision') ||
    rawId.includes('vl') ||
    rawId.includes('pixtral') ||
    rawId.includes('multimodal') ||
    rawId.includes('image')
  ) {
    return {
      supportsImages: true,
      supportsFiles: true,
      modelId: rawId,
      modelName: displayName,
    }
  }

  // 5. OpenRouter Auto router
  if (rawId === 'openrouter/auto' || rawId === 'auto') {
    return {
      supportsImages: true,
      supportsFiles: true,
      modelId: rawId,
      modelName: displayName,
    }
  }

  // 6. Known Text-Only Families:
  // DeepSeek models (R1, V3, V4 Flash, Chat)
  if (rawId.includes('deepseek')) {
    return {
      supportsImages: false,
      supportsFiles: false,
      modelId: rawId,
      modelName: displayName,
      warningReason: `${displayName} is a text-only reasoning model and does not support image or file attachments. Switch to Gemini, Claude 3.7, or GPT-4o for multimodal features.`,
    }
  }

  // Meta Llama (non-vision)
  if (rawId.includes('llama') && !rawId.includes('vision')) {
    return {
      supportsImages: false,
      supportsFiles: false,
      modelId: rawId,
      modelName: displayName,
      warningReason: `${displayName} does not support image or file inputs. Switch to Gemini, Claude 3.7, or GPT-4o for multimodal features.`,
    }
  }

  // Qwen (non-VL)
  if (rawId.includes('qwen') && !rawId.includes('vl')) {
    return {
      supportsImages: false,
      supportsFiles: false,
      modelId: rawId,
      modelName: displayName,
      warningReason: `${displayName} does not support image or file inputs. Switch to a vision-enabled model like Qwen-VL, Gemini, or Claude.`,
    }
  }

  // Mistral / Gemma / Nemotron / GLM / MiMo / Hy3 / Laguna
  if (
    rawId.includes('mistral') ||
    rawId.includes('gemma') ||
    rawId.includes('nemotron') ||
    rawId.includes('glm') ||
    rawId.includes('mimo') ||
    rawId.includes('hy3') ||
    rawId.includes('laguna') ||
    isReasoningMini ||
    isLegacyGpt
  ) {
    return {
      supportsImages: false,
      supportsFiles: false,
      modelId: rawId,
      modelName: displayName,
      warningReason: `${displayName} is a text-only model. Switch to Gemini, Claude 3.7, or GPT-4o to attach images or files.`,
    }
  }

  // Default fallback for unrecognized custom models:
  // If the model name doesn't suggest vision/multimodal capabilities, treat as text-only for safety
  return {
    supportsImages: false,
    supportsFiles: false,
    modelId: rawId,
    modelName: displayName,
    warningReason: `${displayName} is not recognized as a multimodal model. Please switch to Gemini 2.5 Flash, Claude 3.7 Sonnet, or GPT-4o.`,
  }
}
