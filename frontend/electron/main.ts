import { app, BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyElectronSecurityConfig } from './electronSecurityConfig.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const isDevelopment = process.env.NODE_ENV !== 'production'

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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDevelopment) {
    await mainWindow.loadURL('http://127.0.0.1:5173')
    return
  }

  await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
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
