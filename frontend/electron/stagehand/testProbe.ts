import { AGENT_CDP_URL } from '../config.js'
import { localBrowser, Stagehand } from '@browserbasehq/stagehand'
import { createOpenCodeZenClientLLM } from './stagehandClient.js'

async function runProbe() {
  console.log('=== Stagehand Connection Probe ===')
  console.log('Target CDP URL:', AGENT_CDP_URL)

  try {
    const versionRes = await fetch(`${AGENT_CDP_URL}/json/version`)
    const versionData = await versionRes.json()
    console.log('CDP Version response ok:', versionData.Browser)

    console.log('Connecting via localBrowser.connect...')
    const browser = await localBrowser.connect({
      cdpUrl: AGENT_CDP_URL,
    })

    console.log('Connected browser context pages:')
    const pages = await browser.context.pages()
    console.log(`Found ${pages.length} pages:`)
    for (const p of pages) {
      console.log(`- Page ID: ${p.pageId}, URL: ${await p.url()}, Title: ${await p.title()}`)
    }

    const stagehand = await Stagehand.create({
      browser,
      model: createOpenCodeZenClientLLM() as any,
    })

    console.log('Stagehand created successfully. Initialized:', stagehand.initialized)

    const activePage = await browser.context.activePage()
    if (activePage) {
      console.log('Active page URL:', await activePage.url())
      console.log('Active page Title:', await activePage.title())
    }

    console.log('=== Probe Test Completed Successfully ===')
    await stagehand.close()
  } catch (err: any) {
    console.error('Probe failed with error:', err)
  }
}

runProbe()
