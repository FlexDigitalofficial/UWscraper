/**
 * index.js
 *
 * This Express server:
 *   1) Accepts POST /scrape with JSON { url: "<target>" }.
 *   2) Uses puppeteer-extra + stealth plugin (pointing at system Chrome)
 *      to bypass Cloudflare/“Just a moment…” gates and log in to Upwork.
 *   3) After logging in, navigates to the target URL and returns rendered HTML.
 */

const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

// Install the stealth plugin to mask headless signals
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
    // Spoof a standard desktop user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    // 2) Navigate to Upwork’s login page and sign in
    await page.goto('https://www.upwork.com/ab/account-security/login', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    await page.fill('input#login_username', process.env.UPWORK_EMAIL);
    await page.fill('input#login_password', process.env.UPWORK_PASSWORD);
    await page.click('button[type="submit"]');
    // Wait until navigation completes (you are now authenticated)
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 3) Now navigate to the target URL (Upwork job page or any public page)
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    // Wait for <body> to ensure the page is fully rendered
    await page.waitForSelector('body', { timeout: 20000 });

    // 4) Grab and return the fully rendered HTML
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
