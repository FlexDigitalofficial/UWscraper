/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<target>" }.
 * • Navigates to targetUrl using puppeteer-extra + stealth.
 * • If Cloudflare challenge appears, waits for document.title to change from "Just a moment..."
 * and tries to wait for Cloudflare elements to disappear.
 * • If an Upwork login form appears afterward, logs in, re-navigates, and again waits for
 * the title to move away from "Just a moment...".
 * • **Crucially, waits for the main job content to be fully loaded.**
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
    console.log(`[SCRAPER] Starting scrape for URL: ${targetUrl}`);
    // 1) Launch headless Chrome with stealth
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
      headless: true, // true for production, false for local debugging
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    page.setDefaultTimeout(90000); // 90 seconds default timeout for all page operations

    // 2) Go to the target URL (Upwork job or any public page)
    console.log(`[SCRAPER] Navigating to target URL: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }); // Longer initial goto timeout

    // 3) If title is "Just a moment...", we're
