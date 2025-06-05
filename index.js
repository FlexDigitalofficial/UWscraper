/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<targetUrl>" }.
 * • If targetUrl contains "upwork.com/jobs/", Puppeteer will first log in
 *   to Upwork; otherwise, it skips login entirely.
 * • Uses puppeteer-extra + stealth plugin (system Chrome) to bypass Cloudflare.
 * • Returns the fully rendered HTML of the target page.
 */

const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

// Install stealth plugin to mask headless‐browser signals
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
    // 1) Launch Puppeteer-extra using system Chrome
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

    // 2) If the target is an Upwork job page, perform login first
    if (targetUrl.includes('upwork.com/jobs/')) {
      // 2a) Navigate to Upwork login
      await page.goto('https://www.upwork.com/ab/account-security/login', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // 2b) Type email, press Enter, wait for password field
      await page.type('input#login_username', process.env.UPWORK_EMAIL, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForSelector('input#login_password', { timeout: 10000 });

      // 2c) Type password, press Enter, wait for navigation
      await page.type('input#login_password', process.env.UPWORK_PASSWORD, { delay: 50 });
      await page.keyboard.press('Enter');
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 60000
      });
    }

    // 3) Now navigate to the target URL (whether example.com or an Upwork job)
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 20000 });

    // 4) Grab and return the rendered HTML
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
