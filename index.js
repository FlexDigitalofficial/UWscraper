/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<target>" }.
 * • Navigates to targetUrl using puppeteer-extra + stealth.
 * • If Cloudflare challenge appears, waits for document.title to change from "Just a moment..."
 * and tries to wait for Cloudflare elements to disappear.
 * • If an Upwork login form appears afterward, logs in, re-navigates, and again waits for
 * the title to move away from "Just a moment...".
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
    console.error('Validation error: Missing URL in request body.');
    return res.status(400).json({ error: 'Missing URL' });
  }

  let browser;
  try {
    console.log(`Starting scrape for URL: ${targetUrl}`);
    // 1) Launch headless Chrome with stealth
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable', // Use ENV var or fallback
      headless: true, // true for production, false for local debugging
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu', // Often helpful in Docker environments
        '--single-process' // Can help with memory on some systems
      ]
    });

    const page = await browser.newPage();
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    // Set a default timeout for all page operations
    page.setDefaultTimeout(60000); // 60 seconds

    // 2) Go to the target URL (Upwork job or any public page)
    //    Use waitUntil: 'domcontentloaded' initially for speed, then handle more complex waiting
    console.log(`Navigating to target URL: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }); // Increased timeout

    // 3) If title is "Just a moment...", we're stuck on Cloudflare's challenge page.
    let title = await page.title();
    console.log(`Initial page title: ${title}`);

    if (title.includes('Just a moment')) {
      console.log('Cloudflare challenge detected. Waiting for title change and challenge resolution...');
      // Wait up to 45s for the title to change away from "Just a moment..."
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 45000 } // Increased timeout
      ).catch(e => console.log('Timeout waiting for title to change from Cloudflare: ', e.message));

      // Also try to wait for common Cloudflare wrapper elements to disappear
      // This part is heuristic and might need adjustment based on the exact challenge page
      try {
        await page.waitForSelector('#cf-wrapper', { hidden: true, timeout: 15000 });
        console.log('Cloudflare #cf-wrapper disappeared.');
      } catch (e) {
        console.log('Cloudflare #cf-wrapper did not disappear or was not found:', e.message);
      }

      try {
        await page.waitForSelector('input[type="checkbox"][name="cf_challenge_response"]', { hidden: true, timeout: 15000 });
        console.log('Cloudflare checkbox disappeared.');
      } catch (e) {
        console.log('Cloudflare checkbox did not disappear or was not found:', e.message);
      }

      // After initial Cloudflare resolution, give the page a moment to load and settle
      await page.waitForTimeout(3000); // Wait 3 seconds for content to render
      console.log('Finished waiting for Cloudflare elements.');
      title = await page.title(); // Re-check title after waiting
      console.log(`Page title after Cloudflare wait: ${title}`);

      // After Cloudflare, re-evaluate network idle if content isn't fully loaded
      await page.waitForLoadState('networkidle0', { timeout: 30000 }).catch(e => console.log('Timeout waiting for network idle after Cloudflare: ', e.message));
    }


    // 4) At this point, we should be on the real page or potentially a login page. Grab its HTML.
    let html = await page.content();
    console.log(`Initial content length after Cloudflare check: ${html.length} bytes.`);

    // 5) Check if the Upwork login form is present (for private jobs)
    //    We look for the email input and the button#login_password_continue.
    const loginFormPresent = html.includes('input[name="username"]') || html.includes('input#login_username'); // More general check for username input
    const loginContinueButtonPresent = html.includes('button[type="submit"]') || html.includes('button#login_password_continue');


    if (loginFormPresent && loginContinueButtonPresent && process.env.UPWORK_EMAIL && process.env.UPWORK_PASSWORD) {
      console.log('Upwork login form detected. Attempting to log in...');
      // 5a) Perform Upwork login: type email, click Continue, type password, click Continue
      try {
        await page.type('input[name="username"]', process.env.UPWORK_EMAIL, { delay: 50 }); // Adjust selector
        await page.click('button[type="submit"]'); // Adjust selector
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });

        await page.waitForSelector('input[name="password"]', { timeout: 20000 }); // Adjust selector
        await page.type('input[name="password"]', process.env.UPWORK_PASSWORD, { delay: 50 });
        await page.click('button[type="submit"]'); // Adjust selector
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }); // Wait for navigation after login
        console.log('Successfully logged into Upwork (hopefully).');

      } catch (loginErr) {
        console.error('Upwork login failed:', loginErr.message);
        // If login fails, we'll proceed to the final HTML capture, which might still be the login page
      }

      // 5b) Re‐navigate to the original target URL (job page) after login
      console.log(`Re-navigating to target URL after login: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // 5c) Check for Cloudflare once more (rare after login but possible)
      title = await page.title();
      if (title.includes('Just a moment')) {
        console.log('Cloudflare challenge detected AFTER LOGIN. Waiting for resolution...');
        await page.waitForFunction(
          () => !document.title.includes('Just a moment'),
          { timeout: 45000 }
        ).catch(e => console.log('Timeout waiting for title to change after login Cloudflare: ', e.message));

        try {
          await page.waitForSelector('#cf-wrapper', { hidden: true, timeout: 15000 });
        } catch (e) { /* ignore */ }
        await page.waitForTimeout(3000);
        await page.waitForLoadState('networkidle0', { timeout: 30000 }).catch(e => console.log('Timeout waiting for network idle after login Cloudflare: ', e.message));
      }

      // 5d) Grab the final HTML after login & Cloudflare bypass
      html = await page.content();
      console.log(`Final content length after login and Cloudflare check: ${html.length} bytes.`);
    } else if (loginFormPresent && loginContinueButtonPresent) {
      console.log('Upwork login form detected, but UPWORK_EMAIL or UPWORK_PASSWORD environment variables are missing. Skipping login.');
    } else {
      console.log('Upwork login form not detected or credentials not required.');
    }


    await browser.close();
    console.log('Browser closed. Sending response.');
    return res.status(200).send(html);

  } catch (err) {
    console.error('Critical scraping error:', err.message);
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const currentPage = pages[0]; // Get the active page
          const screenshotPath = `error_screenshot_${Date.now()}.png`;
          await currentPage.screenshot({ path: screenshotPath });
          console.error(`Screenshot taken on error: ${screenshotPath}`);
        }
      } catch (screenshotError) {
        console.error('Failed to take screenshot on error:', screenshotError.message);
      }
      await browser.close();
    }
    return res.status(500).json({ error: 'Scraping failed', details: err.message, screenshot_info: 'Screenshot might be available if run locally' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
