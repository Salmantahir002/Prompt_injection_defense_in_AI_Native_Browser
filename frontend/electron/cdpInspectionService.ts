import type { WebContents } from 'electron'

const MAX_TEXT_PER_SOURCE = 24_000
const MAX_NETWORK_BODIES = 40
const MAX_EVENTS_PER_SOURCE = 100

type CdpResponse = Record<string, unknown>

type NetworkRecord = {
  requestId: string
  url: string
  method: string
  resourceType: string
  mimeType: string
  status?: number
  body?: string
  redirect?: string
  fromServiceWorker?: string
}

type FrameTree = {
  frame: { id: string; url?: string }
  childFrames?: FrameTree[]
}

export type DevToolsPageContent = {
  visible_text: string
  hidden_text: string
  html_comments: string
  meta_tags: string
  input_values: string
  page_title: string
  url: string
  aria_text: string
  iframe_content: string
  shadow_dom_content: string
  external_javascript: string
  inline_javascript: string
  css_content: string
  css_generated_content: string
  network_responses: string
  websocket_messages: string
  service_worker_activity: string
  source_maps: string
  redirects: string
  third_party_resources: string
  suspicious_domains: string
  frame_navigation: string
  runtime_script_activity: string
  loaded_resources: string
  dom_snapshot_content: string
}

type InspectionState = {
  contents: WebContents
  requests: Map<string, NetworkRecord>
  responseBodies: Map<string, string>
  websocketMessages: string[]
  serviceWorkerActivity: string[]
  sourceMaps: string[]
  redirects: string[]
  frameNavigation: string[]
  runtimeActivity: string[]
  loadedResources: string[]
}

const emptyContent = (url = ''): DevToolsPageContent => ({
  visible_text: '', hidden_text: '', html_comments: '', meta_tags: '', input_values: '', page_title: '', url,
  aria_text: '', iframe_content: '', shadow_dom_content: '', external_javascript: '', inline_javascript: '',
  css_content: '', css_generated_content: '', network_responses: '', websocket_messages: '',
  service_worker_activity: '', source_maps: '', redirects: '', third_party_resources: '', suspicious_domains: '',
  frame_navigation: '', runtime_script_activity: '', loaded_resources: '', dom_snapshot_content: '',
})

function clip(value: string, limit = MAX_TEXT_PER_SOURCE): string {
  return value.length > limit ? `${value.slice(0, limit)}\n[truncated]` : value
}

function boundedPush(values: string[], value: string, limit = MAX_EVENTS_PER_SOURCE) {
  if (value && values.length < limit) values.push(clip(value, 2_000))
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function collectFrameIds(tree: FrameTree, ids: string[] = []): string[] {
  ids.push(tree.frame.id)
  for (const child of tree.childFrames ?? []) collectFrameIds(child, ids)
  return ids
}

const FRAME_COLLECTOR = `(() => {
  const cap = (value, limit = 12000) => String(value || '').slice(0, limit);
  const unique = values => [...new Set(values.filter(Boolean))];
  const text = node => (node && node.textContent ? node.textContent.trim() : '');
  const comments = [];
  const hidden = [];
  const aria = [];
  const shadow = [];
  const generated = [];
  const visit = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.COMMENT_NODE) comments.push(node.nodeValue || '');
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node;
      const style = getComputedStyle(el);
      const nodeText = text(el);
      if (nodeText && (el.hidden || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden' || style.opacity === '0')) hidden.push(nodeText);
      ['aria-label', 'aria-description', 'aria-valuetext', 'alt', 'title', 'role'].forEach(name => {
        const value = el.getAttribute(name); if (value) aria.push(name + ': ' + value);
      });
      ['before', 'after'].forEach(pseudo => { const value = getComputedStyle(el, '::' + pseudo).content; if (value && value !== 'none' && value !== 'normal') generated.push(value); });
      if (el.shadowRoot) { shadow.push(text(el.shadowRoot)); visit(el.shadowRoot); }
    }
  };
  visit(document);
  const externalScripts = [...document.scripts].filter(s => s.src).map(s => s.src);
  const inlineScripts = [...document.scripts].filter(s => !s.src).map(s => s.textContent || '');
  const externalCss = [...document.querySelectorAll('link[rel~="stylesheet"]')].map(l => l.href);
  const inlineCss = [...document.querySelectorAll('style')].map(s => s.textContent || '');
  const meta = [...document.querySelectorAll('meta[content]')].map(m => m.content);
  const inputs = [...document.querySelectorAll('input, textarea, select, option')].map(el => el.value || text(el));
  return {
    visible_text: cap(document.body && document.body.innerText),
    hidden_text: cap(unique(hidden).join('\n')),
    html_comments: cap(comments.join('\n')),
    meta_tags: cap(meta.join('\n')),
    input_values: cap(inputs.join('\n')),
    page_title: cap(document.title, 500), url: location.href,
    aria_text: cap(unique(aria).join('\n')),
    shadow_dom_content: cap(unique(shadow).join('\n')),
    css_generated_content: cap(unique(generated).join('\n')),
    external_javascript: cap(externalScripts.join('\n')),
    inline_javascript: cap(inlineScripts.join('\n')),
    css_content: cap(externalCss.concat(inlineCss).join('\n')),
  };
})()`

/**
 * Attaches Electron's Chromium debugger to each guest webview. The renderer
 * cannot choose arbitrary targets: only webContents registered by watch() are
 * eligible for a scan request.
 */
export class CdpInspectionService {
  private readonly states = new Map<number, InspectionState>()

  watch(contents: WebContents) {
    if (this.states.has(contents.id)) return
    const state: InspectionState = {
      contents, requests: new Map(), responseBodies: new Map(), websocketMessages: [], serviceWorkerActivity: [],
      sourceMaps: [], redirects: [], frameNavigation: [], runtimeActivity: [], loadedResources: [],
    }
    this.states.set(contents.id, state)
    contents.once('destroyed', () => this.states.delete(contents.id))

    try {
      contents.debugger.attach('1.3')
      this.enableCollection(state)
      contents.debugger.on('message', (_event, method, params) => this.onDebuggerMessage(state, method, params as CdpResponse))
      contents.debugger.on('detach', (_event, reason) => console.warn(`[cdp] Detached from ${contents.id}: ${reason}`))
    } catch (error) {
      console.warn(`[cdp] Could not attach to guest ${contents.id}:`, error)
    }
  }

  private enableCollection(state: InspectionState) {
    void Promise.all([
      this.command(state, 'Network.enable', { maxResourceBufferSize: 1_000_000, maxTotalBufferSize: 10_000_000 }),
      this.command(state, 'Page.enable'), this.command(state, 'Runtime.enable'), this.command(state, 'Debugger.enable'),
      this.command(state, 'DOMSnapshot.enable'), this.command(state, 'Accessibility.enable'),
    ]).catch((error) => console.warn('[cdp] Domain setup failed:', error))
  }

  private command(state: InspectionState, method: string, params?: CdpResponse): Promise<CdpResponse> {
    return state.contents.debugger.sendCommand(method, params) as Promise<CdpResponse>
  }

  private onDebuggerMessage(state: InspectionState, method: string, params: CdpResponse) {
    if (method === 'Network.requestWillBeSent') {
      const request = params.request as CdpResponse | undefined
      const requestId = asString(params.requestId)
      const redirect = params.redirectResponse as CdpResponse | undefined
      const url = asString(request?.url)
      state.requests.set(requestId, { requestId, url, method: asString(request?.method), resourceType: asString(params.type), mimeType: '' })
      boundedPush(state.loadedResources, `${asString(params.type)} ${url}`)
      if (redirect) boundedPush(state.redirects, `${asString(redirect.url)} -> ${url} (${String(redirect.status ?? '')})`)
      return
    }
    if (method === 'Network.responseReceived') {
      const response = params.response as CdpResponse | undefined
      const record = state.requests.get(asString(params.requestId))
      if (!record || !response) return
      record.status = typeof response.status === 'number' ? response.status : undefined
      record.mimeType = asString(response.mimeType)
      const source = asString(response.serviceWorkerResponseSource)
      if (source) { record.fromServiceWorker = source; boundedPush(state.serviceWorkerActivity, `${source}: ${record.url}`) }
      return
    }
    if (method === 'Network.loadingFinished') {
      const requestId = asString(params.requestId)
      const record = state.requests.get(requestId)
      if (!record || state.responseBodies.size >= MAX_NETWORK_BODIES || !this.shouldReadBody(record)) return
      void this.command(state, 'Network.getResponseBody', { requestId }).then((body) => {
        const text = asString(body.body)
        if (text) state.responseBodies.set(requestId, clip(text))
      }).catch(() => undefined)
      return
    }
    if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
      const frame = params.response as CdpResponse | undefined
      boundedPush(state.websocketMessages, `${method.endsWith('Received') ? 'received' : 'sent'}: ${asString(frame?.payloadData)}`)
      return
    }
    if (method === 'Page.frameNavigated') {
      const frame = params.frame as CdpResponse | undefined
      boundedPush(state.frameNavigation, `${asString(frame?.id)} ${asString(frame?.url)}`)
      return
    }
    if (method === 'Debugger.scriptParsed') {
      const url = asString(params.url)
      const sourceMapURL = asString(params.sourceMapURL)
      boundedPush(state.runtimeActivity, `script: ${url || '[inline]'}`)
      if (sourceMapURL) boundedPush(state.sourceMaps, `${url} -> ${sourceMapURL}`)
      return
    }
    if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown') {
      boundedPush(state.runtimeActivity, `${method}: ${JSON.stringify(params).slice(0, 1_500)}`)
    }
  }

  private shouldReadBody(record: NetworkRecord): boolean {
    return ['Document', 'XHR', 'Fetch', 'Script', 'Stylesheet'].includes(record.resourceType)
      || /(?:json|xml|javascript|ecmascript|css|graphql|text)/i.test(record.mimeType)
  }

  async capture(webContentsId: number): Promise<DevToolsPageContent | null> {
    const state = this.states.get(webContentsId)
    if (!state || state.contents.isDestroyed() || !state.contents.debugger.isAttached()) return null

    const base = emptyContent(state.contents.getURL())
    const frameTree = await this.command(state, 'Page.getFrameTree').catch((): CdpResponse => ({}))
    const tree = frameTree.frameTree as FrameTree | undefined
    const frameIds = tree ? collectFrameIds(tree) : []
    const frameResults = await Promise.all(frameIds.map((frameId) => this.collectFrame(state, frameId)))
    const mainFrame = frameResults[0]
    const additionalFrames = frameResults.slice(1)
    const snapshot = await this.command(state, 'DOMSnapshot.captureSnapshot', { computedStyles: ['display', 'visibility', 'content'] }).catch((): CdpResponse => ({}))
    const accessibility = await this.command(state, 'Accessibility.getFullAXTree').catch((): CdpResponse => ({}))
    const serviceWorkers = await this.command(state, 'Runtime.evaluate', { expression: "navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.scope + ' [' + r.active?.state + ']').join('\\n')) : ''", awaitPromise: true, returnByValue: true }).catch((): CdpResponse => ({}))

    if (mainFrame) Object.assign(base, mainFrame)
    base.iframe_content = clip(additionalFrames.map((frame, index) => `Frame ${index + 1}:\n${frame?.visible_text ?? ''}\n${frame?.hidden_text ?? ''}\n${frame?.shadow_dom_content ?? ''}`).join('\n'))
    base.aria_text = clip([base.aria_text, this.axText(accessibility)].filter(Boolean).join('\n'))
    base.dom_snapshot_content = clip(this.snapshotText(snapshot))
    base.network_responses = clip([...state.requests.values()].map((record) => {
      const body = state.responseBodies.get(record.requestId) ?? ''
      return `${record.resourceType} ${record.status ?? ''} ${record.url}\n${body}`
    }).join('\n'))
    base.websocket_messages = clip(state.websocketMessages.join('\n'))
    base.service_worker_activity = clip([...state.serviceWorkerActivity, this.evaluationValue(serviceWorkers)].filter(Boolean).join('\n'))
    base.source_maps = clip(state.sourceMaps.join('\n'))
    base.redirects = clip(state.redirects.join('\n'))
    base.frame_navigation = clip(state.frameNavigation.join('\n'))
    base.runtime_script_activity = clip(state.runtimeActivity.join('\n'))
    base.loaded_resources = clip(state.loadedResources.join('\n'))
    const domains = this.resourceDomains(state, base.url)
    base.third_party_resources = domains.thirdParty.join('\n')
    base.suspicious_domains = domains.suspicious.join('\n')
    return base
  }

  private async collectFrame(state: InspectionState, frameId: string): Promise<Partial<DevToolsPageContent> | null> {
    const world = await this.command(state, 'Page.createIsolatedWorld', { frameId, worldName: 'prompt-defense-inspector', grantUniveralAccess: true }).catch((): CdpResponse => ({}))
    const contextId = typeof world.executionContextId === 'number' ? world.executionContextId : undefined
    if (!contextId) return null
    const result = await this.command(state, 'Runtime.evaluate', { expression: FRAME_COLLECTOR, contextId, returnByValue: true }).catch((): CdpResponse => ({}))
    const resultObject = result.result as CdpResponse | undefined
    const value = resultObject?.value
    return value && typeof value === 'object' ? value as Partial<DevToolsPageContent> : null
  }

  private evaluationValue(result: CdpResponse): string {
    const remote = result.result as CdpResponse | undefined
    return asString(remote?.value)
  }

  private axText(result: CdpResponse): string {
    const nodes = Array.isArray(result.nodes) ? result.nodes as CdpResponse[] : []
    return clip(nodes.map((node) => {
      const role = node.role as CdpResponse | undefined
      const name = node.name as CdpResponse | undefined
      const value = node.value as CdpResponse | undefined
      return [asString(role?.value), asString(name?.value), asString(value?.value)].filter(Boolean).join(': ')
    }).filter(Boolean).join('\n'))
  }

  private snapshotText(result: CdpResponse): string {
    const strings = Array.isArray(result.strings) ? result.strings.filter((value): value is string => typeof value === 'string') : []
    return strings.join('\n')
  }

  private resourceDomains(state: InspectionState, pageUrl: string): { thirdParty: string[]; suspicious: string[] } {
    const pageHost = this.hostname(pageUrl)
    const domains = [...new Set([...state.requests.values()].map((record) => this.hostname(record.url)).filter(Boolean))]
    const thirdParty = domains.filter((domain) => domain !== pageHost && !domain.endsWith(`.${pageHost}`))
    const suspicious = domains.filter((domain) => /(^\d{1,3}(?:\.\d{1,3}){3}$|xn--|\.(zip|mov|top|xyz|click|gq)$)/i.test(domain) || domain.split('.').length > 5)
    return { thirdParty, suspicious }
  }

  private hostname(url: string): string {
    try { return new URL(url).hostname.toLowerCase() } catch { return '' }
  }
}
