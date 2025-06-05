/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<target>" }.
 * • Navigates to targetUrl using puppeteer-extra + stealth.
 * • If Cloudflare challenge appears, waits for document.title to change from "Just a moment..."
 *   (i.e. until the real page has loaded).
 * • If an Upwork login form appears afterward, logs in, re-navigates, and again waits for
 *   the title to move away from "Just a moment...".
 * • Finally returns the fully rendered HTML of the real job page (or any public page).
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
    // 1) Launch headless Chrome with stealth
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

    // 2) Go to the target URL (Upwork job or any public page)
    //    Use waitUntil: 'networkidle2' so Cloudflare JS can run through.
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // 3) If title is "Just a moment...", we're stuck on Cloudflare's challenge page.
    let title = await page.title();
    if (title === 'Just a moment…' || title === 'Just a moment...') {
      // Wait up to 30s for the title to change away from "Just a moment..."
      await page.waitForFunction(
        () => document.title !== 'Just a moment…' && document.title !== 'Just a moment...',
        { timeout: 30000 }
      );
      // Give the page a moment to finish rendering
      await page.waitForTimeout(1000);
    }

    // 4) At this point, we should be on the real page. Grab its HTML.
    let html = await page.content();

    // 5) Check if the Upwork login form is present (for private jobs)
    //    We look for the email input and the button#login_password_continue.
    const loginFormPresent = html.includes('input#login_username') &&
                             html.includes('button#login_password_continue');

    if (loginFormPresent && process.env.UPWORK_EMAIL && process.env.UPWORK_PASSWORD) {
      // 5a) Perform Upwork login: type email, click Continue, type password, click Continue
      await page.type('input#login_username', process.env.UPWORK_EMAIL, { delay: 50 });
      await page.click('button#login_password_continue');
      await page.waitForSelector('input#login_password', { timeout: 20000 });
      await page.type('input#login_password', process.env.UPWORK_PASSWORD, { delay: 50 });
      await page.click('button#login_password_continue');
      // Wait for navigation after login
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

      // 5b) Re‐navigate to the original target URL (job page)
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

      // 5c) Check for Cloudflare once more (rare after login) by checking title again
      title = await page.title();
      if (title === 'Just a moment…' || title === 'Just a moment...') {
        await page.waitForFunction(
          () => document.title !== 'Just a moment…' && document.title !== 'Just a moment...',
          { timeout: 30000 }
        );
        await page.waitForTimeout(1000);
      }

      // 5d) Grab the final HTML after login & Cloudflare bypass
      html = await page.content();
    }

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
