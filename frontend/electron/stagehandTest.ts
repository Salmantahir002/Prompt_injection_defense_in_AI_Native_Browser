import { Stagehand, localBrowser } from '@browserbasehq/stagehand'

export function checkStagehandImport() {
  return typeof Stagehand.create === 'function' && typeof localBrowser.connect === 'function'
}
