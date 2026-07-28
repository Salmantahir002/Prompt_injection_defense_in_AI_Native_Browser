import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyElectronSecurityConfig } from './electronSecurityConfig.js'
import { CdpInspectionService } from './cdpInspectionService.js'
import {
  BrowserRuntime,
  CdpSessionRegistry,
  RUNTIME_INVOKE_CHANNEL,
  parseRuntimeRequest,
  type RuntimeResult,
} from './browserRuntime/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isDevelopment = process.env.PROMPT_DEFENSE_DEV === 'true'

if (isDevelopment) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

app.setPath('userData', path.join(app.getPath('temp'), 'prompt-defense-browser-user-data'))
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
      webviewTag: true,
    },
  })

  applyElectronSecurityConfig(session.defaultSession, mainWindow, isDevelopment)
  // One CDP session per guest webview, shared by the manual scanner and the
  // agent runtime. Electron permits only a single debugger attachment per
  // webContents, so neither consumer may attach on its own.
  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    const session = cdpSessionRegistry.attach(guestContents)
    if (!session) return

    cdpInspectionService.watch(session)
    browserRuntime.registerTarget(session)
    guestContents.once('destroyed', () => {
      cdpInspectionService.forget(session.targetId)
      browserRuntime.unregisterTarget(session.targetId)
    })
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

app.whenReady().then(async () => {
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
