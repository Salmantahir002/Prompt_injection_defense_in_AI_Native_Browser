import { app, BrowserWindow, dialog, ipcMain, session, WebContentsView } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyElectronSecurityConfig } from './electronSecurityConfig.js'
import { attachWebviewContextMenu } from './webviewContextMenu.js'
import { startBackend, stopBackend } from './backendProcess.js'
import { CdpInspectionService } from './cdpInspectionService.js'
import {
  BrowserRuntime,
  CdpSessionRegistry,
  RUNTIME_INVOKE_CHANNEL,
  parseRuntimeRequest,
  type RuntimeResult,
} from './browserRuntime/index.js'

import { providerSecureStore } from './providerSecureStore.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isDevelopment = process.env.PROMPT_DEFENSE_DEV === 'true'

if (isDevelopment) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

app.setPath('userData', path.join(app.getPath('appData'), 'prompt-defense-browser'))
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
app.commandLine.appendSwitch('disk-cache-size', '0')

let mainWindow: BrowserWindow | null = null
const cdpSessionRegistry = new CdpSessionRegistry()
const cdpInspectionService = new CdpInspectionService()
// The runtime borrows the CDP collector as a sensor, but the agent's scan
// travels its own IPC channel, its own backend endpoint, and its own event log.
const browserRuntime = new BrowserRuntime(
  (targetId) => cdpInspectionService.capture(targetId),
  // The agent can ask for an upload, but only the user can say which file.
  // A cancelled dialog is a refusal, and the planner never sees a path.
  async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose files for the agent to upload',
      message: 'The AI agent has requested to attach files to this page.',
      properties: ['openFile', 'multiSelections'],
    })

    return result.canceled ? [] : result.filePaths
  },
)

// Guest pages are hosted as main-owned WebContentsViews, keyed by their own
// webContents id (the same id every other channel — CDP, the scan IPC, the
// runtime IPC — already addresses a tab by). The renderer never holds a
// reference to the guest content itself, only this id.
const tabViews = new Map<number, WebContentsView>()

function requireTabView(event: IpcMainInvokeEvent | IpcMainEvent, webContentsId: unknown): WebContentsView | null {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id || !Number.isInteger(webContentsId)) {
    return null
  }
  return tabViews.get(webContentsId as number) ?? null
}

function sendTabEvent(webContentsId: number, payload: Record<string, unknown>) {
  mainWindow?.webContents.send('browser:tab-event', { webContentsId, ...payload })
}

/** Wires a freshly created guest view into the same sensors a `<webview>` used to attach on `did-attach-webview`. */
function attachGuestBehaviour(view: WebContentsView) {
  const contents = view.webContents
  // Electron's guest content has no native context menu of its own; this is
  // what supplies the Chrome-equivalent Back/Reload/Inspect/Console menu.
  attachWebviewContextMenu(contents, mainWindow as BrowserWindow)

  // One CDP session per guest, shared by the manual scanner and the agent
  // runtime. Electron permits only a single debugger attachment per
  // webContents, so neither consumer may attach on its own.
  const cdpSession = cdpSessionRegistry.attach(contents)
  if (cdpSession) {
    cdpInspectionService.watch(cdpSession)
    browserRuntime.registerTarget(cdpSession)
    contents.once('destroyed', () => {
      cdpInspectionService.forget(cdpSession.targetId)
      browserRuntime.unregisterTarget(cdpSession.targetId)
    })
  }

  const id = contents.id
  contents.on('did-start-loading', () => sendTabEvent(id, { type: 'did-start-loading' }))
  contents.on('did-stop-loading', () => sendTabEvent(id, { type: 'did-stop-loading' }))
  contents.on('did-navigate', (_event, url) => sendTabEvent(id, { type: 'did-navigate', url }))
  contents.on('did-navigate-in-page', (_event, url) => sendTabEvent(id, { type: 'did-navigate-in-page', url }))
  contents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    if (errorCode === -3) return // aborted by a subsequent navigation, not a real failure
    sendTabEvent(id, { type: 'did-fail-load', errorCode, errorDescription })
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#050706',
    title: 'Prompt Defense',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  })

  applyElectronSecurityConfig(session.defaultSession, mainWindow, isDevelopment)
  // Every download prompts for a location, matching the "Save Image As" /
  // "Save Link As" behaviour the webview context menu below triggers.
  session.defaultSession.on('will-download', (_event, item) => {
    const savePath = mainWindow
      ? dialog.showSaveDialogSync(mainWindow, { defaultPath: item.getFilename() })
      : dialog.showSaveDialogSync({ defaultPath: item.getFilename() })
    if (savePath) {
      item.setSavePath(savePath)
    } else {
      item.cancel()
    }
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`[renderer-load-failed] ${errorCode} ${errorDescription} ${validatedUrl}`)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDevelopment) {
    await mainWindow.loadURL('http://localhost:5173').catch((err) => {
      console.warn(`[electron-main] loadURL failed: ${err}`)
    })
    return
  }

  await mainWindow.loadFile(path.join(__dirname, '../dist/index.html')).catch((err) => {
    console.error(`[electron-main] loadFile failed: ${err}`)
  })
}

ipcMain.handle('app:get-version', () => app.getVersion())
ipcMain.handle('security:scan-webview', (event, webContentsId: unknown) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id || !Number.isInteger(webContentsId)) {
    return null
  }

  return cdpInspectionService.capture(webContentsId as number)
})

// Browser tab hosting: the renderer owns tab UI/state, main owns the actual
// guest content as a WebContentsView positioned over an empty React container.
ipcMain.handle('browser:create-tab', (event, url: unknown) => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id || typeof url !== 'string') {
    return null
  }

  const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true } })
  mainWindow.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 }) // invisible until the renderer reports real bounds
  tabViews.set(view.webContents.id, view)
  attachGuestBehaviour(view)
  view.webContents.loadURL(url).catch((err) => {
    console.warn('[main] Initial tab loadURL failed:', err)
  })

  return { webContentsId: view.webContents.id }
})

ipcMain.handle('browser:close-tab', (event, webContentsId: unknown) => {
  const view = requireTabView(event, webContentsId)
  if (!view || !mainWindow) return
  mainWindow.contentView.removeChildView(view)
  tabViews.delete(webContentsId as number)
  if (!view.webContents.isDestroyed()) view.webContents.close()
})

ipcMain.handle('browser:navigate', async (event, webContentsId: unknown, url: unknown) => {
  const view = requireTabView(event, webContentsId)
  if (!view || typeof url !== 'string') return
  // Awaited (unlike the fire-and-forget channels below): the old <webview>.loadURL()
  // resolved only once the navigation landed, and callers — notably the e2e
  // suite's same-URL reloads — depend on that to know the page actually reset.
  try {
    await view.webContents.loadURL(url)
  } catch (err: any) {
    if (err?.code !== 'ERR_ABORTED') console.error('[main] Tab loadURL failed:', err)
  }
})

ipcMain.handle('browser:go-back', (event, webContentsId: unknown) => {
  const view = requireTabView(event, webContentsId)
  if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack()
})

ipcMain.handle('browser:go-forward', (event, webContentsId: unknown) => {
  const view = requireTabView(event, webContentsId)
  if (view?.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward()
})

ipcMain.handle('browser:reload', (event, webContentsId: unknown) => {
  requireTabView(event, webContentsId)?.webContents.reload()
})

ipcMain.handle('browser:execute-javascript', (event, webContentsId: unknown, code: unknown) => {
  const view = requireTabView(event, webContentsId)
  if (!view || typeof code !== 'string') return null
  return view.webContents.executeJavaScript(code)
})

// setBounds fires on every resize/tab-switch — a fire-and-forget `send`
// avoids an IPC round trip on that hot path.
ipcMain.on('browser:set-bounds', (event, webContentsId: unknown, bounds: unknown) => {
  const view = requireTabView(event, webContentsId)
  const rect = bounds as { x: number; y: number; width: number; height: number } | null
  if (!view || !rect) return
  view.setBounds({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  })
})

// Sole entry point for agent-driven browser actions. The manual scan channel
// above is deliberately separate and is never used by the agent runtime.
ipcMain.handle(RUNTIME_INVOKE_CHANNEL, (event, payload: unknown): Promise<RuntimeResult<unknown>> | RuntimeResult<unknown> => {
  if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Runtime commands may only originate from the app shell' } }
  }

  const request = parseRuntimeRequest(payload)
  if (!request) {
    return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Malformed browser runtime request' } }
  }

  return browserRuntime.invoke(request.targetId, request.name, request.params as never)
})

// LLM Provider Credentials & Configuration IPC
ipcMain.handle('providers:get-all', () => {
  return providerSecureStore.getAllProviders()
})

ipcMain.handle('providers:save', async (_event, payload: any) => {
  const result = providerSecureStore.saveProvider(payload)
  if (payload.set_active) {
    await providerSecureStore.syncWithBackend()
  }
  return result
})

ipcMain.handle('providers:delete', async (_event, providerId: string) => {
  const success = providerSecureStore.deleteProvider(providerId)
  await providerSecureStore.syncWithBackend()
  return { ok: success }
})

ipcMain.handle('providers:set-active', async (_event, payload: { id: string | null; selected_model?: string }) => {
  providerSecureStore.setActiveProvider(payload.id, payload.selected_model)
  await providerSecureStore.syncWithBackend()
  return { ok: true }
})

ipcMain.handle('providers:get-active', () => {
  const all = providerSecureStore.getAllProviders()
  return all.find((p) => p.is_active) || null
})

app.whenReady().then(async () => {
  // Packaged / e2e runs have no concurrently wrapper — bring the backend up here.
  await startBackend()

  await createWindow()

  // Sync saved active provider to the Node backend in the background
  setTimeout(() => {
    providerSecureStore.syncWithBackend().catch((err) => {
      console.warn('[main] Initial provider backend sync failed:', err)
    })
  }, 1000)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('will-quit', () => {
  stopBackend()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
