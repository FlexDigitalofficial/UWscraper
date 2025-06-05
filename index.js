/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<target>" }.
 * • Uses puppeteer-extra+stealth to bypass Cloudflare.
 * • Navigates to targetUrl. If Cloudflare’s JS‐challenge appears,
 *   waits for it to redirect to the real page.
 * • If an Upwork login form appears, logs in, then re-navigates.
 * • Returns the final page HTML.
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
    // 1) Launch headless Chrome via puppeteer-extra
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

    // 2) Go to the target URL (Upwork job page or any URL)
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 3) Detect if Cloudflare challenge is present
    //    Cloudflare appends a redirect to "/cdn-cgi/challenge-platform" while it runs JS.
    //    Also, the page source will contain "cf_chl_opt" in a <script> tag.
    let currentUrl = page.url();
    const isChallengePage = () => {
      return (
        currentUrl.includes('/cdn-cgi/challenge-platform') ||
        // also check if HTML contains Cloudflare challenge indicators
        page.content().then(html => html.includes('cf_chl_opt'))
      );
    };

    // 4) If we hit the challenge, wait for the JS to redirect to the real page
    if (currentUrl.includes('/cdn-cgi/challenge-platform') || (await page.content()).includes('cf_chl_opt')) {
      console.log('Cloudflare challenge detected, waiting for redirect…');
      // Wait up to 30 seconds for the URL to change away from the challenge
      await page.waitForFunction(
        () => !window.location.href.includes('/cdn-cgi/challenge-platform'),
        { timeout: 30000 }
      );
      // Give the page a moment to fully load its content
      await page.waitForTimeout(2000);
    }

    // 5) After bypassing Cloudflare, re-check URL (it should now be targetUrl or equivalent)
    currentUrl = page.url();

    // 6) If this is an Upwork job and login is required, detect and log in
    const htmlAfterCF = await page.content();
    const loginFormPresent = htmlAfterCF.includes('input#login_username') &&
                             htmlAfterCF.includes('button#login_password_continue');

    if (loginFormPresent && process.env.UPWORK_EMAIL && process.env.UPWORK_PASSWORD) {
      console.log('Login form detected, performing login…');
      // a) Type email and submit
      await page.type('input#login_username', process.env.UPWORK_EMAIL, { delay: 50 });
      await page.click('button#login_password_continue');
      await page.waitForSelector('input#login_password', { timeout: 20000 });
      // b) Type password and submit
      await page.type('input#login_password', process.env.UPWORK_PASSWORD, { delay: 50 });
      await page.click('button#login_password_continue');
      // c) Wait for navigation post-login
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
      // d) Re‐navigate to the original target URL
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // e) Possibly repeat Cloudflare bypass if necessary (rare after login)
      currentUrl = page.url();
      if (currentUrl.includes('/cdn-cgi/challenge-platform') || (await page.content()).includes('cf_chl_opt')) {
        console.log('Post-login Cloudflare challenge, waiting again…');
        await page.waitForFunction(
          () => !window.location.href.includes('/cdn-cgi/challenge-platform'),
          { timeout: 30000 }
        );
        await page.waitForTimeout(2000);
      }
    }

    // 7) Wait for <body> (final page should be fully loaded now)
    await page.waitForSelector('body', { timeout: 20000 });
    const finalHtml = await page.content();
    await browser.close();
    return res.status(200).send(finalHtml);

  } catch (err) {
    console.error('Scraping error:', err.message);
    if (browser) await browser.close();
    return res.status(500).json({ error: 'Scraping failed', details: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
