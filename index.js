/**
 * index.js
 *
 * Express + Puppeteer-extra-stealth scraper:
 *   • Uses /usr/bin/google-chrome-stable
 *   • Bypasses Cloudflare “Just a moment…” pages via stealth plugin
 *   • Optionally, insert a login flow if Upwork requires authentication
 */

const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

// Install the stealth plugin
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
    // 1) Launch Puppeteer-extra using the system Chrome binary
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    // --------------------------------------------------------
    // OPTIONAL LOGIN FLOW FOR UPWORK (uncomment if needed)
    // --------------------------------------------------------
    await page.goto('https://www.upwork.com/ab/account-security/login', {
       waitUntil: 'networkidle2', timeout: 60000
    });
     await page.fill('input#login_username', process.env.UPWORK_EMAIL);
     await page.fill('input#login_password', process.env.UPWORK_PASSWORD);
     await page.click('button[type="submit"]');
     await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    --------------------------------------------------------

    // 2) Bypass Cloudflare / JS challenge by waiting for networkidle2
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 20000 });

    // 3) Return the fully rendered HTML
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
