/**
 * index.js
 *
 * This Express server:
 *   1) Accepts POST /scrape with JSON { url: "<target>" }.
 *   2) Uses puppeteer-extra + stealth plugin (pointing at system Chrome) to bypass Cloudflare/recaptcha.
 */

const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  const targetUrl = req.body.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing URL' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    // Wait for Cloudflare to clear (Stealth plugin should help bypass)
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 20000 });

    const html = await page.content();
    await browser.close();
    return res.status(200).send(html);

  } catch (err) {
    console.error('Scraping error:', err.message);
    if (browser) await browser.close();
    return res.status(500).json({ error: 'Scraping failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));