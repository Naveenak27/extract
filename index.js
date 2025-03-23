require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { extractEmails, extractLinks, fetchPage, prioritizeUrls, storeEmailInSupabase } = require('./scraper-utils');
const bulkScraper = require('./bulk-scraper');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase client
const SUPABASE_URL = 'https://iweptmijpkljukcmroxv.supabase.co';

const SUPABASE_KEY = process.env.SUPABASE_KEY; // Make sure to set this in your environment
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// At the top of your file, before other requires

// Middleware
app.use(cors());
app.use(express.json());

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  try {
    const { url, maxPages = 100, thoroughScan = false } = req.body;
    
    // Allow overriding the max pages for thorough scans
    const effectiveMaxPages = thoroughScan ? 300 : maxPages;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    console.log('='.repeat(50));
    console.log(`STARTING ULTRA-POWERFUL HR EMAIL EXTRACTION: ${url}`);
    console.log(`Maximum pages to scan: ${effectiveMaxPages}`);
    console.log(`Thorough scan mode: ${thoroughScan ? 'ENABLED' : 'DISABLED'}`);
    console.log('='.repeat(50));
    
    // Track progress
    const startTime = Date.now();
    let totalEmailsFound = 0;
    let emailsStoredInDb = 0;
    
    // Track processed URLs and pages with emails
    const processedUrls = new Set();
    const pagesWithEmails = new Set();
    const foundEmails = [];
    const errors = [];
    
    // Track unique emails (case insensitive)
    const uniqueEmails = new Set();
    
    // PHASE 1: COMPREHENSIVE SITE MAPPING
    console.log('='.repeat(50));
    console.log('PHASE 1: COMPREHENSIVE SITE MAPPING');
    console.log('='.repeat(50));
    
    // Critical page patterns - these MUST be checked
    const criticalPagePatterns = [
      // Career and jobs pages - highest priority
      /careers?\/?$|careers?\//i,
      /jobs?\/?$|jobs?\//i,
      /work.*?with.*?us|join.*?us|employment|vacancies|openings/i,
      /careers?\.html|jobs?\.html|careers?\.php|jobs?\.php/i,
      /recruit|hiring|apply|application|vacancy|position/i,
      /career-opportunities|job-opportunities|open-positions/i,
      /employment-opportunities|current-openings|available-positions/i,
      /we-are-hiring|join-our-team|join-the-team|become-part-of/i,
      /work-with-us|work-for-us|work-at/i,
      /job-listings|job-board|career-board|job-search/i,
      
      // Contact and about pages - high priority
      /contact|about.*?us|team|people|staff|directory|department/i,
      /our-team|meet-the-team|meet-our-team|our-people|our-staff/i,
      /contact-us|get-in-touch|reach-us|connect-with-us/i,
      /about-company|about-firm|who-we-are|what-we-do/i,
      /our-company|our-firm|our-business|our-mission/i,
      /team-members|team-bios|staff-members|staff-directory/i,
      /employee-directory|personnel|faculty|our-experts/i,
      
      // Other potential HR contact points - medium priority
      /company|opportunities|leadership|management|corporate/i,
      /human-resources|hr-department|hr-team|hr-contact/i,
      /executive-team|board-of-directors|leadership-team/i,
      /our-leadership|our-management|executive-management/i,
      /corporate-info|corporate-information|company-info/i,
      /board-members|c-suite|senior-leadership|executives/i,
      
      // Additional pages that might contain career/contact information
      /internships|fellowships|traineeships|apprenticeships/i,
      /talent-acquisition|talent-pool|talent-community/i,
      /careers-faq|job-faq|application-process|how-to-apply/i,
      /benefits|perks|why-work-here|why-join-us/i,
      /locations|offices|branches|sites|headquarters/i,
      /diversity|inclusion|equal-opportunity|accessibility/i,
      /culture|values|workplace|environment/i,
      /alumni|former-employees|employee-testimonials/i,
      /newsroom|press|media|news|press-releases/i,
      /investors|investor-relations|shareholders|stakeholders/i,
      /partners|partnerships|collaborations|affiliates/i,
      /support|help|assistance|customer-service|feedback/i
    ];
        
    // First pass: Comprehensive site mapping with intelligent crawling
    const criticalPages = new Set();
    const highValuePages = new Set();
    const regularPages = new Set();
    
    let urlsToDiscover = [url];
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
      
      const currentUrl = urlsToDiscover.shift();
      
      if (processedUrls.has(currentUrl)) {
        continue;
      }
      
      processedUrls.add(currentUrl);
      discoveryPagesScanned++;
      
      const isCritical = criticalPagePatterns.some(pattern => pattern.test(currentUrl));
      console.log(`[MAPPING ${discoveryPagesScanned}/${maxDiscoveryPages}] ${isCritical ? '⭐ CRITICAL:' : 'Regular:'} ${currentUrl}`);
      
      // Fetch page with minimal delay between requests
      await new Promise(resolve => setTimeout(resolve, 150));
      const html = await fetchPage(currentUrl, 3); // More retries for critical pages
      
      if (!html) {
        errors.push(`Failed to fetch during discovery: ${currentUrl}`);
        continue;
      }
      
      // Classify page importance
      if (criticalPagePatterns.slice(0, 4).some(pattern => pattern.test(currentUrl))) {
        criticalPages.add(currentUrl);
        console.log(`  ⭐⭐ HIGHEST PRIORITY PAGE IDENTIFIED: ${currentUrl}`);
      } else if (criticalPagePatterns.slice(4, 6).some(pattern => pattern.test(currentUrl))) {
        criticalPages.add(currentUrl);
        console.log(`  ⭐ HIGH PRIORITY PAGE IDENTIFIED: ${currentUrl}`);
      } else if (criticalPagePatterns.slice(6).some(pattern => pattern.test(currentUrl))) {
        highValuePages.add(currentUrl);
        console.log(`  🔍 MEDIUM PRIORITY PAGE IDENTIFIED: ${currentUrl}`);
      } else {
        regularPages.add(currentUrl);
      }
      
      // While we're here, do a quick scan for emails on critical pages to avoid missing anything
      if (isCritical) {
        const quickEmailScan = extractEmails(html, currentUrl);
        if (quickEmailScan.length > 0) {
          console.log(`  📧 ${quickEmailScan.length} emails detected on critical page during mapping`);
          pagesWithEmails.add(currentUrl);
        }
      }
      
      // Extract all links for further discovery with enhanced extraction
      let links = extractLinks(html, currentUrl);
      
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
    for (const currentUrl of urlsToProcess) {
      if (processedUrls.has(currentUrl)) {
        continue;
      }
      
      processedUrls.add(currentUrl);
      pagesScanned++;
      
      // Determine page priority for logging
      let pageType = "Regular";
      if (criticalPages.has(currentUrl)) pageType = "⭐ CRITICAL";
      else if (pagesWithEmails.has(currentUrl)) pageType = "📧 HAS EMAILS";
      else if (highValuePages.has(currentUrl)) pageType = "🔍 HIGH VALUE";
      
      console.log(`[${pagesScanned}/${urlsToProcess.length}] ${pageType}: ${currentUrl}`);
      
      // Dynamic delay based on page importance
      const delay = criticalPages.has(currentUrl) ? 300 : 500;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Fetch with more retries for important pages
      const retries = criticalPages.has(currentUrl) ? 4 : 2;
      const html = await fetchPage(currentUrl, retries);
      
      if (!html) {
        errors.push(`Failed to fetch: ${currentUrl}`);
        continue;
      }
      
      // Enhanced email extraction with pattern learning
      const emailsOnPage = extractEmails(html, currentUrl);
      
      if (emailsOnPage.length > 0) {
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
              potentialHrEmails++;
              newPotentialEmails++;
            }
          }
          
          // Process and store HR-related emails
          if (item.isHrRelated && !uniqueEmails.has(lowerCaseEmail)) {
            uniqueEmails.add(lowerCaseEmail);
            foundEmails.push(item);
            hrEmailsFound++;
            newHrEmails++;
            
            // Store in database with enhanced metadata
            try {
              const storageResult = await storeEmailInSupabase(supabase, {
                email: lowerCaseEmail,
                source: currentUrl,
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
        
        // Log results specifically showing HR classification
        console.log(`  Found ${newHrEmails} new HR email(s) and reclassified ${newPotentialEmails} as potential HR emails`);
      }
      
      // Progress report with enhanced statistics
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const pagesPerSecond = (pagesScanned / elapsedSeconds).toFixed(2);
      console.log(`  Progress: ${pagesScanned}/${urlsToProcess.length} pages | ${hrEmailsFound} HR emails | ${potentialHrEmails} potential HR emails | ${emailsStoredInDb} stored in DB | ${pagesPerSecond} p/s`);
    }
    
    // Final scan report with detailed statistics
    const totalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    console.log('='.repeat(50));
    console.log('ULTRA-POWERFUL SCAN COMPLETED');
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
    
    // Return comprehensive results
    return res.json({ 
      success: true,
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
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      error: 'Failed to scrape website', 
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

// Enhanced email extraction with improved HR detection
function extractEnhancedEmails(html, pageUrl) {
  // Base implementation from your code
  const emailsOnPage = extractEmails(html, pageUrl);
  
  // Additional HTML parsing for structured data like contact forms
  const $ = cheerio.load(html);
  
  // Scan for contact forms which often contain hidden email addresses
  $('form').each((_, form) => {
    // Look for email input fields
    $(form).find('input[type="email"]').each((_, input) => {
      const placeholder = $(input).attr('placeholder');
      if (placeholder && placeholder.toLowerCase().includes('email')) {
        // Capture form context for HR classification
        const formText = $(form).text().trim();
        const formAction = $(form).attr('action') || '';
        
        // If this appears to be a job application or contact form
        if (formText.match(/job|career|apply|contact|resume|cv/i) || 
            formAction.match(/job|career|apply|contact/i)) {
          emailsOnPage.push({
            email: 'contact@' + new URL(pageUrl).hostname, // Generate likely contact email
            isHrRelated: true,
            context: `Contact form found - likely HR contact point (${formText.substring(0, 100)}...)`,
            foundOn: pageUrl,
            confidence: 'medium',
            source: 'contact_form'
          });
        }
      }
    });
  });
  
  return emailsOnPage;
}// Status endpoint to check if server is running
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
