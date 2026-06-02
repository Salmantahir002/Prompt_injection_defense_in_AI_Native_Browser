import type { BrowserWindow, Session } from 'electron'

const DEV_ORIGIN = 'http://localhost:5173'

function isTrustedAppUrl(url: string, isDevelopment: boolean): boolean {
  if (isDevelopment && url.startsWith(DEV_ORIGIN)) {
    return true
  }

  return url.startsWith('file://')
}

export function applyElectronSecurityConfig(
  appSession: Session,
  mainWindow: BrowserWindow,
  isDevelopment: boolean,
) {
  appSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }

    headers['X-Content-Type-Options'] = ['nosniff']
    headers['Referrer-Policy'] = ['no-referrer']
    callback({ responseHeaders: headers })
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url, isDevelopment)) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
