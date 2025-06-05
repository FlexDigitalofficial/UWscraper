/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<targetUrl>" }.
 * • Navigates directly to targetUrl.
 * • If the page HTML includes Upwork’s login form, performs login:
 *     – Types into input#login_username
 *     – Clicks button#login_password_continue to go to password step
 *     – Types into input#login_password
 *     – Clicks button#login_password_continue to submit
 *     – Waits for navigation, then re-navigates to targetUrl
 * • Uses puppeteer-extra + stealth plugin to bypass Cloudflare/JS checks.
 * • Returns the fully rendered HTML of the target page.
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

    // 2) Navigate directly to the target URL
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 20000 });

    // 3) Check if Upwork login form is present
    const content = await page.content();
    const loginFormPresent = content.includes('input#login_username') &&
                             content.includes('button#login_password_continue');

    if (loginFormPresent && process.env.UPWORK_EMAIL && process.env.UPWORK_PASSWORD) {
      // 4a) Type email into input#login_username
      await page.type('input#login_username', process.env.UPWORK_EMAIL, { delay: 50 });
      // 4b) Click the “Continue” button to advance to password step
      await page.click('button#login_password_continue');
      // 4c) Wait for password field to appear
      await page.waitForSelector('input#login_password', { timeout: 20000 });
      // 4d) Type password into input#login_password
      await page.type('input#login_password', process.env.UPWORK_PASSWORD, { delay: 50 });
      // 4e) Click the same button to submit login form
      await page.click('button#login_password_continue');
      // 4f) Wait for navigation after login
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

      // 5) Now that we're authenticated, re-navigate to targetUrl
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 20000 });
    }

    // 6) Finally, grab and return the fully rendered HTML
    const finalHtml = await page.content();
    await browser.close();
    return res.status(200).send(finalHtml);

  } catch (err) {
    console.error('Scraping error:', err.message);
    if (browser) await browser.close();
    return res.status(500).json({ error: 'Scraping failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
