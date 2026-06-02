import type { BrowserWindow, Session } from 'electron'

const DEV_ORIGIN = 'http://127.0.0.1:5173'

const productionCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' http://localhost:8000 http://127.0.0.1:8000",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src https: http:",
].join('; ')

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

    if (!isDevelopment) {
      headers['Content-Security-Policy'] = [productionCsp]
    }

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
