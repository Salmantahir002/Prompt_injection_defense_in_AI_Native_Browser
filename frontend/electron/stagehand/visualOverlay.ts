/**
 * Visual feedback overlay injected into the page:
 * 1. Virtual cursor pointer that glides to target elements before click/fill actions.
 * 2. Click ripple pulse at target coordinates when an action fires.
 * 3. Left-to-right laser/scan sweep beam across the viewport when the agent analyzes/observes the page.
 * 4. Ambient breathing border during active task execution.
 *
 * Designed with strict non-interference:
 * - pointer-events: none on all elements
 * - z-index: 2147483647
 * - Trusted Types & CSP safe (constructed via createElement/setAttribute/Web Animations API)
 * - Excluded from security snapshots and text extractions
 */

const MOVE_MS = 140
const CLICK_MS = 140
const SCAN_SWEEP_MS = 400

export const VISUAL_OVERLAY_BOOTSTRAP = `(function () {
  if (window.__stagehandVisualOverlay) return window.__stagehandVisualOverlay;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var api = {};
  var nodes = null;

  function styleOf(el, props) {
    for (var key in props) el.style.setProperty(key, props[key]);
    return el;
  }

  function host() { return document.body || document.documentElement; }

  function buildArrow() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M3 2 L3 19 L7.8 14.5 L11.2 21.8 L14.5 20.2 L11 13.2 L17.5 13.2 Z');
    path.setAttribute('fill', '#ffffff');
    path.setAttribute('stroke', '#090d16');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return styleOf(svg, { display: 'block', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.75))' });
  }

  function build() {
    if (nodes && nodes.root && nodes.root.isConnected) return nodes;
    var parent = host();
    if (!parent) return null;

    var base = { position: 'fixed', 'pointer-events': 'none', margin: '0', padding: '0', 'user-select': 'none' };

    var root = styleOf(document.createElement('div'), Object.assign({}, base, {
      id: '__prompt_defense_agent_overlay__',
      'aria-hidden': 'true',
      top: '0', left: '0', width: '0', height: '0', 'z-index': '2147483647',
    }));

    // Ambient glow
    var glow = styleOf(document.createElement('div'), Object.assign({}, base, {
      top: '0', left: '0', width: '100vw', height: '100vh', opacity: '0',
      'box-shadow': 'inset 0 0 0 2px rgba(47,123,255,.5), inset 0 0 40px 6px rgba(47,123,255,.25)',
    }));

    // Scan sweep beam (left-to-right laser scanner)
    var scanBeam = styleOf(document.createElement('div'), Object.assign({}, base, {
      top: '0', left: '-150px', width: '140px', height: '100vh', opacity: '0',
      background: 'linear-gradient(90deg, transparent 0%, rgba(47,123,255,0.08) 30%, rgba(47,123,255,0.35) 85%, rgba(100,175,255,0.85) 98%, #ffffff 100%)',
      'box-shadow': '0 0 20px rgba(47,123,255,0.6)',
      'will-change': 'transform, opacity',
    }));

    // Virtual cursor
    var cursor = styleOf(document.createElement('div'), Object.assign({}, base, {
      top: '0', left: '0', width: '24px', height: '24px', opacity: '0',
      transform: 'translate3d(0,0,0)', 'will-change': 'transform',
    }));
    cursor.appendChild(buildArrow());

    // Ripple click effect
    var ripple = styleOf(document.createElement('div'), Object.assign({}, base, {
      top: '0', left: '0', width: '24px', height: '24px', 'margin-left': '-12px',
      'margin-top': '-12px', 'border-radius': '50%', opacity: '0',
      border: '2px solid rgba(255,255,255,0.95)', background: 'rgba(255,255,255,0.3)',
      'box-shadow': '0 0 10px rgba(255,255,255,0.7)',
    }));

    // Status label badge
    var label = styleOf(document.createElement('div'), Object.assign({}, base, {
      top: '0', left: '0', opacity: '0', font: '600 11px/1.5 system-ui,-apple-system,sans-serif',
      color: '#fff', background: 'rgba(15,23,42,.92)', padding: '2px 8px', 'border-radius': '999px',
      'white-space': 'nowrap', 'box-shadow': '0 2px 8px rgba(0,0,0,.45)', border: '1px solid rgba(255,255,255,0.15)',
      transform: 'translate(18px, 12px)',
    }));

    root.appendChild(glow);
    root.appendChild(scanBeam);
    root.appendChild(ripple);
    root.appendChild(cursor);
    root.appendChild(label);
    parent.appendChild(root);

    nodes = { root: root, glow: glow, scanBeam: scanBeam, cursor: cursor, ripple: ripple, label: label, x: 0, y: 0 };
    return nodes;
  }

  function place(el, x, y) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  api.moveTo = function (x, y, text) {
    var n = build();
    if (!n) return;
    var fromX = n.x, fromY = n.y;
    var isFirst = n.cursor.style.opacity === '0';
    n.x = x; n.y = y;

    n.cursor.style.opacity = '1';
    place(n.cursor, x, y);
    place(n.label, x, y);

    if (text) {
      n.label.textContent = text;
      n.label.style.opacity = '1';
    } else {
      n.label.style.opacity = '0';
    }

    if (n.cursor.animate && !isFirst) {
      var dx = fromX - x, dy = fromY - y;
      var opts = { duration: ${MOVE_MS}, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'none' };
      n.cursor.animate([
        { transform: 'translate3d(' + dx + 'px,' + dy + 'px,0)' },
        { transform: 'translate3d(0,0,0)' }
      ], opts);
      n.label.animate([
        { transform: 'translate(' + (18 + dx) + 'px,' + (12 + dy) + 'px)' },
        { transform: 'translate(18px,12px)' }
      ], opts);
    } else if (n.cursor.animate) {
      n.cursor.animate([
        { opacity: 0, transform: 'scale(.6)' },
        { opacity: 1, transform: 'scale(1)' }
      ], { duration: ${MOVE_MS}, easing: 'ease-out' });
    }
  };

  api.clickAt = function (x, y) {
    var n = build();
    if (!n) return;
    api.moveTo(x, y);
    place(n.ripple, x, y);
    if (n.ripple.animate) {
      n.ripple.animate([
        { transform: 'scale(.2)', opacity: 0.95 },
        { transform: 'scale(2.8)', opacity: 0 }
      ], { duration: ${CLICK_MS}, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }
    if (n.cursor.animate) {
      n.cursor.animate([
        { transform: 'scale(1)' },
        { transform: 'scale(.75)', offset: 0.35 },
        { transform: 'scale(1)' }
      ], { duration: ${CLICK_MS}, easing: 'ease-out' });
    }
  };

  api.scanSweep = function () {
    var n = build();
    if (!n || !n.scanBeam.animate) return;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1200;
    n.scanBeam.style.opacity = '1';
    n.scanBeam.animate([
      { transform: 'translateX(0px)', opacity: 0.9 },
      { transform: 'translateX(' + (vw + 200) + 'px)', opacity: 0.95, offset: 0.85 },
      { transform: 'translateX(' + (vw + 300) + 'px)', opacity: 0 }
    ], { duration: ${SCAN_SWEEP_MS}, easing: 'cubic-bezier(.35, 0, .25, 1)' });
  };

  api.setGlow = function (active) {
    var n = build();
    if (!n) return;
    n.glow.style.opacity = active ? '1' : '0';
  };

  api.remove = function () {
    if (nodes && nodes.root && nodes.root.parentNode) {
      nodes.root.parentNode.removeChild(nodes.root);
    }
    nodes = null;
    delete window.__stagehandVisualOverlay;
  };

  window.__stagehandVisualOverlay = api;
  return api;
})();`

export class VisualOverlayManager {
  private enabled = true

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async ensureInjected(webContents: Electron.WebContents): Promise<void> {
    if (!this.enabled || webContents.isDestroyed()) return
    try {
      await webContents.executeJavaScript(VISUAL_OVERLAY_BOOTSTRAP)
    } catch (err) {
      // Safe ignore on navigation transitions
    }
  }

  async moveTo(webContents: Electron.WebContents, x: number, y: number, text?: string): Promise<void> {
    if (!this.enabled || webContents.isDestroyed()) return
    try {
      await this.ensureInjected(webContents)
      const js = `window.__stagehandVisualOverlay && window.__stagehandVisualOverlay.moveTo(${Number(x) || 0}, ${Number(y) || 0}, ${JSON.stringify(text || '')});`
      await webContents.executeJavaScript(js)
      // Small visual pause so user sees cursor movement before click
      await new Promise((resolve) => setTimeout(resolve, MOVE_MS))
    } catch {
      // Ignore animation errors
    }
  }

  async clickAt(webContents: Electron.WebContents, x: number, y: number): Promise<void> {
    if (!this.enabled || webContents.isDestroyed()) return
    try {
      await this.ensureInjected(webContents)
      const js = `window.__stagehandVisualOverlay && window.__stagehandVisualOverlay.clickAt(${Number(x) || 0}, ${Number(y) || 0});`
      await webContents.executeJavaScript(js)
      await new Promise((resolve) => setTimeout(resolve, CLICK_MS))
    } catch {
      // Ignore animation errors
    }
  }

  async scanSweep(webContents: Electron.WebContents): Promise<void> {
    if (!this.enabled || webContents.isDestroyed()) return
    try {
      await this.ensureInjected(webContents)
      const js = `window.__stagehandVisualOverlay && window.__stagehandVisualOverlay.scanSweep();`
      await webContents.executeJavaScript(js)
    } catch {
      // Ignore animation errors
    }
  }

  async setGlow(webContents: Electron.WebContents, active: boolean): Promise<void> {
    if (webContents.isDestroyed()) return
    try {
      if (this.enabled) {
        await this.ensureInjected(webContents)
        const js = `window.__stagehandVisualOverlay && window.__stagehandVisualOverlay.setGlow(${active});`
        await webContents.executeJavaScript(js)
      }
    } catch {
      // Ignore animation errors
    }
  }

  async clear(webContents: Electron.WebContents): Promise<void> {
    if (webContents.isDestroyed()) return
    try {
      const js = `window.__stagehandVisualOverlay && window.__stagehandVisualOverlay.remove();`
      await webContents.executeJavaScript(js)
    } catch {
      // Ignore cleanup errors
    }
  }
}

export const visualOverlay = new VisualOverlayManager()
