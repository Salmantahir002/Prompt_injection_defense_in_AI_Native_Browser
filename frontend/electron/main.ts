import { app, BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyElectronSecurityConfig } from './electronSecurityConfig.js'

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
