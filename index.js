require('dotenv').config();

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const fetch = require("node-fetch");
const { createClient } = require('@supabase/supabase-js');
const { extractEmails, extractLinks, fetchPage, prioritizeUrls, storeEmailInSupabase, scrapeWebsite } = require('./scraper-utils');
const bulkScraper = require('./bulk-scraper');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase client
const SUPABASE_URL = 'https://iweptmijpkljukcmroxv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Make sure to set this in your environment
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Improved CORS configuration
app.use(cors({
  origin: '*', // Allow all origins - you can restrict this to specific domains in production
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add OPTIONS handler for preflight requests
app.options('*', cors());

app.use(express.json());
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = process.env.RENDER_SERVICE_ID;

// API Route to Restart Render Server

app.post("/restart-server", async (req, res) => {
    try {
        console.log("Attempting to redeploy with cleared cache...");
        console.log(`Using service ID: ${SERVICE_ID}`);
        
        // Using an empty object as body worked previously
        const renderResponse = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${RENDER_API_KEY}`,
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({}) // Empty object for the body
        });
        
        console.log("Response status:", renderResponse.status);
        const responseText = await renderResponse.text();
        console.log("Response body:", responseText);
        
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            return res.status(renderResponse.status).json({ 
                error: "Invalid JSON response", 
                responseText 
            });
        }
        
        if (!renderResponse.ok) {
            return res.status(renderResponse.status).json({ 
                error: data.message || "Failed to trigger deployment.",
                details: data
            });
        }
        
        res.status(200).json({
            message: "Fresh deployment with cleared cache triggered successfully!",
            deployId: data.id
        });
    } catch (error) {
        console.error("Error details:", error);
        res.status(500).json({ 
            error: "Internal server error", 
            message: error.message,
            stack: error.stack
        });
    }
});


// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  try {
    // Accept either a single URL or an array of URLs
    const { url, urls, maxPages = 100, thoroughScan = false } = req.body;
    
    // Process URLs - handle both single url and array input formats
    const urlsToProcess = urls ? 
      (Array.isArray(urls) ? urls : [urls]) : 
      (url ? [url] : []);
    
    if (urlsToProcess.length === 0) {
      return res.status(400).json({ error: 'At least one URL is required' });
    }
    
    // Allow overriding the max pages for thorough scans
    const effectiveMaxPages = thoroughScan ? 300 : maxPages;
    
    // Validate all URLs
    for (const urlToCheck of urlsToProcess) {
      try {
        new URL(urlToCheck);
      } catch (e) {
        return res.status(400).json({ error: `Invalid URL format: ${urlToCheck}` });
      }
    }
    
    console.log('='.repeat(50));
    console.log(`STARTING ULTRA-POWERFUL HR EMAIL EXTRACTION FOR ${urlsToProcess.length} URLs`);
    console.log(`Maximum pages to scan per URL: ${effectiveMaxPages}`);
    console.log(`Thorough scan mode: ${thoroughScan ? 'ENABLED' : 'DISABLED'}`);
    console.log('='.repeat(50));
    
    // Overall results
    const overallResults = {
      totalPagesScanned: 0,
      totalEmailsFound: 0,
      totalHrEmailsFound: 0,
      totalEmailsStoredInDb: 0,
      totalScanDurationSeconds: 0,
      urlResults: []
    };
    
    // Process each URL one by one
    for (let urlIndex = 0; urlIndex < urlsToProcess.length; urlIndex++) {
      const currentUrl = urlsToProcess[urlIndex];
      console.log('='.repeat(50));
      console.log(`PROCESSING URL ${urlIndex + 1}/${urlsToProcess.length}: ${currentUrl}`);
      console.log('='.repeat(50));
      
      // Track progress for this URL
      const startTime = Date.now();
      let totalEmailsFound = 0;
      let emailsStoredInDb = 0;
      
      // Track processed URLs and pages with emails for this URL
      const processedUrls = new Set();
      const pagesWithEmails = new Set();
      const foundEmails = [];
      const errors = [];
      
      // Track unique emails (case insensitive)
      const uniqueEmails = new Set();
      
      // Launch a new browser instance for each URL to prevent memory issues
      const browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1280,800'
        ],
        ignoreHTTPSErrors: true,
      });
      
      try {
        // PHASE 1: COMPREHENSIVE SITE MAPPING
        console.log('='.repeat(50));
        console.log(`PHASE 1: COMPREHENSIVE SITE MAPPING FOR ${currentUrl}`);
        console.log('='.repeat(50));
        
        // Critical page patterns - these MUST be checked
        const criticalPagePatterns = [
          // Career and jobs pages - highest priority
          /careers?\/?$|careers?\/|jobs?\/?$|jobs?\//i,
          /work.*?with.*?us|join.*?us|employment|vacancies|openings/i,
          /careers?\.html|jobs?\.html|careers?\.php|jobs?\.php/i,
          /recruit|hiring|apply|application|vacancy|position/i,
          
          // Contact and about pages - high priority
          /contact|about.*?us|team|people|staff|directory|department/i,
          
          // Other potential HR contact points - medium priority
          /company|opportunities|leadership|management|corporate/i
        ];
        
        // First pass: Comprehensive site mapping with intelligent crawling
        const criticalPages = new Set();
        const highValuePages = new Set();
        const regularPages = new Set();
        
        let urlsToDiscover = [currentUrl];
        let discoveryPagesScanned = 0;
        const maxDiscoveryPages = Math.min(100, effectiveMaxPages / 2);
        
        // Enhanced site structure discovery
        while (urlsToDiscover.length > 0 && discoveryPagesScanned < maxDiscoveryPages) {
          // Sort URLs to prioritize potential career/jobs pages even during discovery
          urlsToDiscover.sort((a, b) => {
            const aIsCritical = criticalPagePatterns.some(pattern => pattern.test(a));
            const bIsCritical = criticalPagePatterns.some(pattern => pattern.test(b));
            return bIsCritical - aIsCritical;
          });
          
          const currentDiscoveryUrl = urlsToDiscover.shift();
          
          if (processedUrls.has(currentDiscoveryUrl)) {
            continue;
          }
          
          processedUrls.add(currentDiscoveryUrl);
          discoveryPagesScanned++;
          
          const isCritical = criticalPagePatterns.some(pattern => pattern.test(currentDiscoveryUrl));
          console.log(`[MAPPING ${discoveryPagesScanned}/${maxDiscoveryPages}] ${isCritical ? '⭐ CRITICAL:' : 'Regular:'} ${currentDiscoveryUrl}`);
          
          // Fetch page with minimal delay between requests using Puppeteer
          await new Promise(resolve => setTimeout(resolve, 150));
          const html = await fetchPage(currentDiscoveryUrl, browser, 3); // More retries for critical pages
          
          if (!html) {
            errors.push(`Failed to fetch during discovery: ${currentDiscoveryUrl}`);
            continue;
          }
          
          // Classify page importance
          if (criticalPagePatterns.slice(0, 4).some(pattern => pattern.test(currentDiscoveryUrl))) {
            criticalPages.add(currentDiscoveryUrl);
            console.log(`  ⭐⭐ HIGHEST PRIORITY PAGE IDENTIFIED: ${currentDiscoveryUrl}`);
          } else if (criticalPagePatterns.slice(4, 6).some(pattern => pattern.test(currentDiscoveryUrl))) {
            criticalPages.add(currentDiscoveryUrl);
            console.log(`  ⭐ HIGH PRIORITY PAGE IDENTIFIED: ${currentDiscoveryUrl}`);
          } else if (criticalPagePatterns.slice(6).some(pattern => pattern.test(currentDiscoveryUrl))) {
            highValuePages.add(currentDiscoveryUrl);
            console.log(`  🔍 MEDIUM PRIORITY PAGE IDENTIFIED: ${currentDiscoveryUrl}`);
          } else {
            regularPages.add(currentDiscoveryUrl);
          }
          
          // While we're here, do a quick scan for emails on critical pages to avoid missing anything
          if (isCritical) {
            const quickEmailScan = extractEmails(html, currentDiscoveryUrl);
            if (quickEmailScan.length > 0) {
              console.log(`  📧 ${quickEmailScan.length} emails detected on critical page during mapping:`);
              // Display the detected emails and immediately store HR-related ones
              for (let index = 0; index < quickEmailScan.length; index++) {
                const emailItem = quickEmailScan[index];
                console.log(`    ${index + 1}. ${emailItem.email} ${emailItem.isHrRelated ? '(HR Related)' : ''}`);
                
                // Immediately add HR-related emails to the database
                if (emailItem.isHrRelated) {
                  const lowerCaseEmail = emailItem.email.toLowerCase();
                  if (!uniqueEmails.has(lowerCaseEmail)) {
                    uniqueEmails.add(lowerCaseEmail);
                    foundEmails.push(emailItem);
                    
                    // Store HR email immediately in database
                    try {
                      const storageResult = await storeEmailInSupabase(supabase, {
                        email: lowerCaseEmail,
                        source: currentDiscoveryUrl,
                        context: emailItem.context || null,
                        isHrRelated: true,
                        pageType: 'CRITICAL'
                      });
                      
                      if (storageResult.success) {
                        if (storageResult.status === 'inserted') {
                          emailsStoredInDb++;
                          console.log(`  ✓ Immediately stored HR email during mapping: ${lowerCaseEmail}`);
                        } else {
                          console.log(`  • HR email already in database: ${lowerCaseEmail}`);
                        }
                      } else {
                        console.log(`  ✗ Failed to store HR email: ${lowerCaseEmail} - ${storageResult.error}`);
                      }
                    } catch (dbError) {
                      console.error(`  ✗ Database error for ${lowerCaseEmail}:`, dbError);
                    }
                  }
                }
              }
              
              pagesWithEmails.add(currentDiscoveryUrl);
            }
          }
          
          // Extract all links for further discovery with enhanced extraction
          let links = extractLinks(html, currentDiscoveryUrl);
          
          // Add new links to the discovery queue
          for (const link of links) {
            if (!processedUrls.has(link) && !urlsToDiscover.includes(link)) {
              urlsToDiscover.push(link);
            }
          }
        }
        
        // Reset for Phase 2
        processedUrls.clear();
        
        console.log('='.repeat(50));
        console.log(`PHASE 1 COMPLETE: Found ${criticalPages.size} critical pages, ${highValuePages.size} high-value pages, ${regularPages.size} regular pages`);
        console.log(`${pagesWithEmails.size} pages were detected to contain email addresses`);
        console.log('='.repeat(50));
        
        // PHASE 2: INTELLIGENT EMAIL EXTRACTION
        console.log('='.repeat(50));
        console.log('PHASE 2: INTELLIGENT EMAIL EXTRACTION');
        console.log('='.repeat(50));
        
        // Prepare prioritized URL list for processing
        const allPrioritizedUrls = [
          // Critical pages first (career/jobs focused)
          ...criticalPages,
          // Then pages already known to contain emails (if not already in critical)
          ...[...pagesWithEmails].filter(url => !criticalPages.has(url)),
          // Then high-value pages (contact, about, etc)
          ...[...highValuePages].filter(url => !pagesWithEmails.has(url) && !criticalPages.has(url)),
          // Then regular pages as discovered
          ...[...regularPages].filter(url => !highValuePages.has(url) && !pagesWithEmails.has(url) && !criticalPages.has(url))
        ];
        
        // Respect the page limit
        let urlsToProcess = allPrioritizedUrls.slice(0, effectiveMaxPages);
        
        console.log(`Will process ${criticalPages.size} critical, ${pagesWithEmails.size} email-containing, and ${urlsToProcess.length - criticalPages.size - pagesWithEmails.size} other pages (${urlsToProcess.length} total)`);
        
        let pagesScanned = 0;
        let hrEmailsFound = 0;
        let potentialHrEmails = 0;
        
        // Advanced processing with dynamic HR detection improvements
        let knownHrDomains = new Set();
        let commonEmailPrefixes = new Set();
        
        // Process each URL with advanced classification
        for (const urlToProcess of urlsToProcess) {
          if (processedUrls.has(urlToProcess)) {
            continue;
          }
          
          processedUrls.add(urlToProcess);
          pagesScanned++;
          
          // Determine page priority for logging
          let pageType = "Regular";
          if (criticalPages.has(urlToProcess)) pageType = "⭐ CRITICAL";
          else if (pagesWithEmails.has(urlToProcess)) pageType = "📧 HAS EMAILS";
          else if (highValuePages.has(urlToProcess)) pageType = "🔍 HIGH VALUE";
          
          console.log(`[${pagesScanned}/${urlsToProcess.length}] ${pageType}: ${urlToProcess}`);
          
          // Dynamic delay based on page importance
          const delay = criticalPages.has(urlToProcess) ? 300 : 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          
          // Fetch with more retries for important pages
          const retries = criticalPages.has(urlToProcess) ? 4 : 2;
          const html = await fetchPage(urlToProcess, browser, retries);
          
          if (!html) {
            errors.push(`Failed to fetch: ${urlToProcess}`);
            continue;
          }
          
          // Enhanced email extraction with pattern learning
          const emailsOnPage = extractEmails(html, urlToProcess);
          
          if (emailsOnPage.length > 0) {
            // Log all emails found on this page
            console.log(`  Found ${emailsOnPage.length} total emails on this page:`);
            emailsOnPage.forEach((emailItem, index) => {
              console.log(`    ${index + 1}. ${emailItem.email} ${emailItem.isHrRelated ? '(HR Related)' : ''}`);
            });
            
            // Process each email with dynamic classification improvements
            let newHrEmails = 0;
            let newPotentialEmails = 0;
            
            for (const item of emailsOnPage) {
              const lowerCaseEmail = item.email.toLowerCase();
              const [localPart, domain] = lowerCaseEmail.split('@');
              
              // Learning: If we've found HR emails, remember their domains and prefixes
              if (item.isHrRelated) {
                knownHrDomains.add(domain);
                commonEmailPrefixes.add(localPart);
              }
              
              // Dynamic classification improvements:
              // If email matches pattern of previously found HR emails, upgrade it
              if (!item.isHrRelated) {
                if (knownHrDomains.has(domain) || 
                    [...commonEmailPrefixes].some(prefix => 
                      levenshteinDistance(localPart, prefix) <= 2)) {
                  item.isHrRelated = true;
                  item.context += " [Reclassified as HR due to pattern matching]";
                  console.log(`    ↑ Reclassified as HR email: ${lowerCaseEmail}`);
                  potentialHrEmails++;
                  newPotentialEmails++;
                }
              }
              
              // Process and store HR-related emails IMMEDIATELY
              if (item.isHrRelated) {
                if (!uniqueEmails.has(lowerCaseEmail)) {
                  uniqueEmails.add(lowerCaseEmail);
                  foundEmails.push(item);
                  hrEmailsFound++;
                  newHrEmails++;
                  
                  // Store in database with enhanced metadata immediately
                  try {
                    const storageResult = await storeEmailInSupabase(supabase, {
                      email: lowerCaseEmail,
                      source: urlToProcess,
                      context: item.context || null,
                      isHrRelated: true,
                      pageType: pageType.replace(/[⭐📧🔍 ]/g, '')  // Clean emoji for db storage
                    });
                    
                    if (storageResult.success) {
                      if (storageResult.status === 'inserted') {
                        emailsStoredInDb++;
                        console.log(`  ✓ Stored HR email: ${lowerCaseEmail}`);
                      } else {
                        console.log(`  • HR email already in database: ${lowerCaseEmail}`);
                      }
                    } else {
                      console.log(`  ✗ Failed to store HR email: ${lowerCaseEmail} - ${storageResult.error}`);
                    }
                  } catch (dbError) {
                    console.error(`  ✗ Database error for ${lowerCaseEmail}:`, dbError);
                  }
                }
              }
            }
            
            // Log results specifically showing HR classification
            console.log(`  Found ${newHrEmails} new HR email(s) and reclassified ${newPotentialEmails} as potential HR emails`);
          }
          
          // Progress report with enhanced statistics
          const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
          const pagesPerSecond = (pagesScanned / elapsedSeconds).toFixed(2);
          console.log(`  Progress: ${pagesScanned}/${urlsToProcess.length} pages | ${hrEmailsFound} HR emails | ${potentialHrEmails} potential HR emails | ${emailsStoredInDb} stored in DB | ${pagesPerSecond} p/s`);
        }
        
        // Final scan report for this URL with detailed statistics
        const totalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        console.log('='.repeat(50));
        console.log(`SCAN COMPLETED FOR ${currentUrl}`);
        console.log('='.repeat(50));
        console.log(`Total pages scanned: ${pagesScanned}`);
        console.log(` - Critical pages: ${[...processedUrls].filter(url => criticalPages.has(url)).length}`);
        console.log(` - Pages with emails: ${[...processedUrls].filter(url => pagesWithEmails.has(url)).length}`);
        console.log(` - High-value pages: ${[...processedUrls].filter(url => highValuePages.has(url)).length}`);
        console.log(`Total HR emails found: ${hrEmailsFound}`);
        console.log(`Additional potential HR emails identified: ${potentialHrEmails}`);
        console.log(`Total emails stored in database: ${emailsStoredInDb}`);
        console.log(`Scan duration: ${totalTimeSeconds} seconds`);
        console.log(`Pages per second: ${(pagesScanned / totalTimeSeconds).toFixed(2)}`);
        
        if (errors.length > 0) {
          console.log(`Errors encountered: ${errors.length}`);
        }
        
        console.log('='.repeat(50));
        
        // Log all unique emails found for this URL
        console.log('ALL UNIQUE EMAILS FOUND:');
        foundEmails.forEach((item, index) => {
          console.log(`  ${index + 1}. ${item.email} - Found on: ${item.foundOn || item.source}`);
        });
        console.log('='.repeat(50));
        
        // Enhanced analytics for better insights
        const emailsByDomain = foundEmails.reduce((acc, item) => {
          const domain = item.email.split('@')[1];
          if (!acc[domain]) {
            acc[domain] = [];
          }
          acc[domain].push(item.email);
          return acc;
        }, {});
        
        // Group by email pattern for insights
        const emailsByPattern = foundEmails.reduce((acc, item) => {
          const localPart = item.email.split('@')[0];
          // Group by common prefixes
          const prefix = localPart.match(/^[a-z]+/i)?.[0] || 'other';
          if (!acc[prefix]) {
            acc[prefix] = [];
          }
          acc[prefix].push(item.email);
          return acc;
        }, {});
        
        // Add this URL's results to the overall results
        overallResults.totalPagesScanned += pagesScanned;
        overallResults.totalEmailsFound += foundEmails.length;
        overallResults.totalHrEmailsFound += hrEmailsFound;
        overallResults.totalEmailsStoredInDb += emailsStoredInDb;
        overallResults.totalScanDurationSeconds += totalTimeSeconds;
        
        // Add individual URL results
        overallResults.urlResults.push({
          url: currentUrl,
          stats: {
            pagesScanned,
            criticalPagesScanned: [...processedUrls].filter(url => criticalPages.has(url)).length,
            pagesWithEmailsScanned: [...processedUrls].filter(url => pagesWithEmails.has(url)).length,
            totalHrEmailsFound: hrEmailsFound,
            potentialHrEmailsFound: potentialHrEmails,
            emailsStoredInDb,
            scanDurationSeconds: totalTimeSeconds
          },
          emailDetails: foundEmails,
          emailsByDomain,
          emailsByPattern,
          criticalPagesScanned: Array.from(criticalPages).filter(url => processedUrls.has(url)),
          errors: errors.length > 0 ? errors : undefined
        });
        
      } finally {
        // Always close the browser after processing each URL
        await browser.close();
      }
    }
    
    // Return combined results for all URLs
    console.log('='.repeat(50));
    console.log('ULTRA-POWERFUL SCAN COMPLETED FOR ALL URLS');
    console.log('='.repeat(50));
    console.log(`Total URLs processed: ${urlsToProcess.length}`);
    console.log(`Total pages scanned across all URLs: ${overallResults.totalPagesScanned}`);
    console.log(`Total HR emails found: ${overallResults.totalHrEmailsFound}`);
    console.log(`Total emails stored in database: ${overallResults.totalEmailsStoredInDb}`);
    console.log(`Total scan duration: ${overallResults.totalScanDurationSeconds} seconds`);
    console.log('='.repeat(50));
    
    return res.json({
      success: true,
      stats: {
        totalUrlsProcessed: urlsToProcess.length,
        totalPagesScanned: overallResults.totalPagesScanned,
        totalEmailsFound: overallResults.totalEmailsFound,
        totalHrEmailsFound: overallResults.totalHrEmailsFound,
        totalEmailsStoredInDb: overallResults.totalEmailsStoredInDb,
        totalScanDurationSeconds: overallResults.totalScanDurationSeconds
      },
      urlResults: overallResults.urlResults
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      error: 'Failed to scrape websites', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
// Utility for checking similarity between email prefixes
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// Status endpoint to check if server is running
app.get('/status', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Register the bulk scraper routes
app.use(bulkScraper);

// Start the server
app.listen(PORT, () => {
  console.log(`Email scraper server running on port ${PORT}`);
  console.log(`Server ready to scan websites for emails and store them in Supabase`);
});
