import { chromium } from '@playwright/test'

const out = process.argv[2]
const acts = ['idle', 'wave', 'think', 'look', 'cheer']

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 640, height: 220 }, deviceScaleFactor: 2 })
await page.goto('http://localhost:5199/kimo-preview.html', { waitUntil: 'networkidle' })
await page.waitForSelector('.kimo')

for (const act of acts) {
  // Freeze the routine, then hold the gesture at ~45% of its cycle.
  await page.evaluate((a) => {
    document.querySelectorAll('.kimo').forEach((el) => el.setAttribute('data-act', a))
  }, act)
  await page.waitForTimeout(150)
  await page.evaluate(() => {
    document.getAnimations().forEach((anim) => {
      anim.pause()
      anim.currentTime = (anim.effect?.getTiming().duration || 1000) * 0.45
    })
  })
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${out}/kimo-${act}.png` })
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
}

await browser.close()
console.log('done')
