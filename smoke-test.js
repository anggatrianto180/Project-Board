// smoke-test.js
// Simple Puppeteer script to verify Trade Journal full-page toggle and DOM class swaps.
// Usage: node smoke-test.js

const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  // load local file - adjust path if serving via http server
  const file = `file://${process.cwd().replace(/\\/g,'/')}/index.html`;
  await page.goto(file, { waitUntil: 'networkidle0' });

  // Click trade button
  await page.click('#trade-btn');
  await page.waitForTimeout(500);

  const isTradeVisible = await page.evaluate(() => {
    const el = document.getElementById('trade-section');
    return el && !el.classList.contains('hidden') && document.body.classList.contains('trade-full');
  });

  const hasDarkBg = await page.evaluate(() => {
    const sample = document.querySelector('#trade-section .bg-gray-900');
    return !!sample;
  });

  console.log('Trade visible:', isTradeVisible);
  console.log('Dark utility present:', hasDarkBg);

  await browser.close();
})();
