import type { CdpParams, CdpSession } from './browserRuntime/cdpSession.js'

const MAX_TEXT_PER_SOURCE = 60_000
const MAX_EVENTS_PER_SOURCE = 100

type CdpResponse = Record<string, unknown>

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
  source_maps: string
  dom_snapshot_content: string
}

type InspectionState = {
  session: CdpSession
  sourceMaps: string[]
}

const emptyContent = (url = ''): DevToolsPageContent => ({
  visible_text: '', hidden_text: '', html_comments: '', meta_tags: '', input_values: '', page_title: '', url,
  aria_text: '', iframe_content: '', shadow_dom_content: '', external_javascript: '', inline_javascript: '',
  css_content: '', css_generated_content: '', source_maps: '', dom_snapshot_content: '',
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
  const cap = (value, limit = 30000) => String(value || '').slice(0, limit);
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
    hidden_text: cap(unique(hidden).join('\\n')),
    html_comments: cap(comments.join('\\n')),
    meta_tags: cap(meta.join('\\n')),
    input_values: cap(inputs.join('\\n')),
    page_title: cap(document.title, 500), url: location.href,
    aria_text: cap(unique(aria).join('\\n')),
    shadow_dom_content: cap(unique(shadow).join('\\n')),
    css_generated_content: cap(unique(generated).join('\\n')),
    external_javascript: cap(externalScripts.join('\\n')),
    inline_javascript: cap(inlineScripts.join('\\n')),
    css_content: cap(externalCss.concat(inlineCss).join('\\n')),
  };
})()`

const INSPECTION_DOMAINS = ['Page', 'Runtime', 'Debugger', 'DOMSnapshot', 'Accessibility'] as const
const INSPECTION_DOMAIN_PARAMS: Record<string, CdpParams> = {}

/**
 * Backs the user-initiated "Scan Page" workflow. It observes each guest
 * webview through the shared CdpSession rather than attaching Electron's
 * debugger itself, since a webContents permits only one attachment and the
 * agent Browser Runtime needs the same channel.
 *
 * The renderer cannot choose arbitrary targets: only sessions registered by
 * watch() are eligible for a scan request.
 */
export class CdpInspectionService {
  private readonly states = new Map<number, InspectionState>()

  watch(session: CdpSession) {
    if (this.states.has(session.targetId)) return
    const state: InspectionState = { session, sourceMaps: [] }
    this.states.set(session.targetId, state)

    this.enableCollection(state)
    session.on((method, params) => this.onDebuggerMessage(state, method, params as CdpResponse))
  }

  forget(targetId: number) {
    this.states.delete(targetId)
  }

  private enableCollection(state: InspectionState) {
    void state.session.enableDomains(INSPECTION_DOMAINS, INSPECTION_DOMAIN_PARAMS)
      .catch((error) => console.warn('[cdp] Domain setup failed:', error))
  }

  private command(state: InspectionState, method: string, params?: CdpResponse): Promise<CdpResponse> {
    return state.session.send(method, params)
  }

  private onDebuggerMessage(state: InspectionState, method: string, params: CdpResponse) {
    if (method === 'Debugger.scriptParsed') {
      const url = asString(params.url)
      const sourceMapURL = asString(params.sourceMapURL)
      if (sourceMapURL) boundedPush(state.sourceMaps, `${url} -> ${sourceMapURL}`)
    }
  }

  async capture(webContentsId: number): Promise<DevToolsPageContent | null> {
    const state = this.states.get(webContentsId)
    if (!state || !state.session.isAlive()) return null

    const base = emptyContent(state.session.url())
    const frameTree = await this.command(state, 'Page.getFrameTree').catch((): CdpResponse => ({}))
    const tree = frameTree.frameTree as FrameTree | undefined
    const frameIds = tree ? collectFrameIds(tree) : []
    const frameResults = await Promise.all(frameIds.map((frameId) => this.collectFrame(state, frameId)))
    const mainFrame = frameResults[0]
    const additionalFrames = frameResults.slice(1)
    const snapshot = await this.command(state, 'DOMSnapshot.captureSnapshot', { computedStyles: ['display', 'visibility', 'content'] }).catch((): CdpResponse => ({}))
    const accessibility = await this.command(state, 'Accessibility.getFullAXTree').catch((): CdpResponse => ({}))

    if (mainFrame) Object.assign(base, mainFrame)
    base.iframe_content = clip(additionalFrames.map((frame, index) => `Frame ${index + 1}:\n${frame?.visible_text ?? ''}\n${frame?.hidden_text ?? ''}\n${frame?.shadow_dom_content ?? ''}`).join('\n'))
    base.aria_text = clip([base.aria_text, this.axText(accessibility)].filter(Boolean).join('\n'))
    base.dom_snapshot_content = clip(this.snapshotText(snapshot))
    base.source_maps = clip(state.sourceMaps.join('\n'))
    return base
  }

  private async collectFrame(state: InspectionState, frameId: string): Promise<Partial<DevToolsPageContent> | null> {
    const world = await this.command(state, 'Page.createIsolatedWorld', {
      frameId,
      worldName: 'prompt-defense-inspector',
      grantUniversalAccess: true,
    }).catch((error): CdpResponse => {
      console.warn(`[cdp] createIsolatedWorld failed for frame ${frameId}:`, error)
      return {}
    })

    const contextId = typeof world.executionContextId === 'number' ? world.executionContextId : undefined
    if (!contextId) return null

    const result = await this.command(state, 'Runtime.evaluate', {
      expression: FRAME_COLLECTOR,
      contextId,
      returnByValue: true,
    }).catch((error): CdpResponse => {
      console.warn(`[cdp] Frame collector evaluate failed for frame ${frameId}:`, error)
      return {}
    })

    if (result.exceptionDetails) {
      console.warn(`[cdp] Frame collector threw for frame ${frameId}:`, JSON.stringify(result.exceptionDetails).slice(0, 600))
      return null
    }

    const resultObject = result.result as CdpResponse | undefined
    const value = resultObject?.value
    return value && typeof value === 'object' ? value as Partial<DevToolsPageContent> : null
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
}
