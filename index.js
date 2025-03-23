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
// Improved controller for HR email scraping with memory optimization and enhanced filtering
app.post('/scrape', async (req, res) => {
  try {
    const { url, maxPages = 100, thoroughScan = false } = req.body;
    
    // Allow overriding the max pages for thorough scans with a reasonable upper limit
    const effectiveMaxPages = thoroughScan ? Math.min(300, maxPages * 2) : maxPages;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Validate URL
    let baseUrl;
    try {
      baseUrl = new URL(url);
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
    
    // Track processed URLs and pages with emails - using Maps instead of Sets for better memory management
    // Map instead of Set allows associating metadata with URLs for smarter processing
    const processedUrls = new Map(); // url -> { hasEmails: boolean, priority: number }
    const foundEmails = []; // Limited array size
    const errors = [];
    
    // Track unique emails (case insensitive) with a more efficient structure
    const uniqueEmails = new Map(); // email -> { count: number, sources: Set<string> }
    
    // Define critical page patterns - these MUST be checked
    const criticalPagePatterns = [
      // Career and jobs pages - highest priority
      /careers?\/?$|careers?\/|jobs?\/?$|jobs?\//i,
      /work.*?with.*?us|join.*?us|employment|vacancies|openings/i,
      /careers?\.html|jobs?\.html|careers?\.php|jobs?\.php/i,
      /positions?\/?$|positions?\/|opportunities\/?$/i,
      /recruitment|hiring|talent|apply(-|_|\.)now|jointeam|joinus/i,
      
      // Contact and about pages - high priority
      /contact|about.*?us|team|people|staff|directory/i
    ];
    
    // Extended list of file extensions to skip - CRUCIAL for memory optimization
    const excludedExtensions = [
      // Documents and media
      '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.ppsx', '.xls', '.xlsx', 
      '.csv', '.rtf', '.txt', '.zip', '.rar', '.tar', '.gz', '.7z',
      // Images
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
      // Audio/Video
      '.mp3', '.mp4', '.wav', '.avi', '.mov', '.wmv', '.flv', '.mkv',
      // Other
      '.xml', '.json', '.rss', '.atom', '.css', '.js', '.map',
      // Fonts
      '.ttf', '.otf', '.woff', '.woff2', '.eot'
    ];
    
    // Skip URLs containing these patterns (site sections usually irrelevant to HR)
    const excludedPatterns = [
      // Media and resources that rarely contain HR contact info
      '/wp-content/', '/wp-includes/', '/wp-admin/', '/wp-json/', '/admin/',
      '/assets/', '/static/', '/dist/', '/build/', '/node_modules/',
      '/press-release/', '/news/', '/blog/', '/article/', '/podcast/', '/webinar/',
      '/media/', '/gallery/', '/photos/', '/images/', '/video/', '/download/',
      
      // Technical areas
      '/documentation/', '/manual/', '/guide/', '/tutorial/', '/faq/', '/help/',
      
      // Customer areas
      '/support/', '/service/', '/ticket/', '/knowledge-base/',
      
      // Marketing areas
      '/testimonial/', '/casestudy/', '/success-story/',
      
      // Product areas
      '/product/', '/feature/', '/solution/', '/platform/', '/technology/',
      
      // Shopping
      '/shop/', '/store/', '/cart/', '/checkout/', '/order/', '/payment/', '/pricing/',
      
      // User account areas
      '/login/', '/signin/', '/signup/', '/register/', '/account/', '/profile/', '/dashboard/',
      
      // Legal pages
      '/privacy/', '/terms/', '/policy/', '/legal/', '/cookie/', 
      
      // Navigation
      '/sitemap/', '/rss/', '/feed/', '/api/', '/search/', '/404/', '/error/',
      
      // Calendar/events
      '/event/', '/calendar/', '/schedule/', '/agenda/', '/conference/'
    ];
    
    // First check if the URL itself contains any excluded extensions
    const urlPath = baseUrl.pathname.toLowerCase();
    if (excludedExtensions.some(ext => urlPath.endsWith(ext))) {
      return res.status(400).json({
        error: 'URL appears to be a file, not a webpage',
        details: 'The provided URL points to a file type that cannot contain emails'
      });
    }
    
    // Memory-efficient priority queues for URL processing
    const criticalQueue = [];
    const highPriorityQueue = [];
    const regularQueue = [];
    
    // PHASE 1: SMART SITE MAPPING WITH MEMORY MANAGEMENT
    console.log('='.repeat(50));
    console.log('PHASE 1: MEMORY-OPTIMIZED SMART SITE MAPPING');
    console.log('='.repeat(50));
    
    // Start with the seed URL
    let urlsToDiscover = [url];
    let discoveryPagesScanned = 0;
    
    // Calculate discovery limit based on site size expectations
    const maxDiscoveryPages = Math.min(50, Math.ceil(effectiveMaxPages / 3));
    
    // Optimize memory usage by processing URLs in batches
    const discoveryBatchSize = 10;
    
    // Enhanced site structure discovery with memory optimization
    while (urlsToDiscover.length > 0 && discoveryPagesScanned < maxDiscoveryPages) {
      // Process in batches to allow for GC between batches
      const currentBatch = urlsToDiscover.splice(0, discoveryBatchSize);
      
      // Process each URL in the batch with proper filtering
      for (const currentUrl of currentBatch) {
        // Skip if already processed
        if (processedUrls.has(currentUrl)) {
          continue;
        }
        
        // Skip URLs with excluded patterns or extensions
        const urlObj = new URL(currentUrl);
        const path = urlObj.pathname.toLowerCase();
        
        if (excludedExtensions.some(ext => path.endsWith(ext))) {
          console.log(`Skipping file URL: ${currentUrl}`);
          processedUrls.set(currentUrl, { hasEmails: false, priority: -1 });
          continue;
        }
        
        if (excludedPatterns.some(pattern => path.includes(pattern))) {
          console.log(`Skipping excluded pattern URL: ${currentUrl}`);
          processedUrls.set(currentUrl, { hasEmails: false, priority: -1 });
          continue;
        }
        
        processedUrls.set(currentUrl, { hasEmails: false, priority: 0 });
        discoveryPagesScanned++;
        
        // Determine page criticality for prioritization
        const isCritical = criticalPagePatterns.some(pattern => pattern.test(currentUrl));
        console.log(`[MAPPING ${discoveryPagesScanned}/${maxDiscoveryPages}] ${isCritical ? '⭐ CRITICAL:' : 'Regular:'} ${currentUrl}`);
        
        // Fetch page with minimal delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        const html = await fetchPage(currentUrl, isCritical ? 3 : 1);
        
        if (!html) {
          errors.push(`Failed to fetch during discovery: ${currentUrl}`);
          continue;
        }
        
        // Classify page importance for queue assignment
        if (criticalPagePatterns.slice(0, 5).some(pattern => pattern.test(currentUrl))) {
          criticalQueue.push(currentUrl);
          processedUrls.set(currentUrl, { hasEmails: false, priority: 3 });
          console.log(`  ⭐⭐ HIGHEST PRIORITY PAGE IDENTIFIED: ${currentUrl}`);
        } else if (criticalPagePatterns.slice(5).some(pattern => pattern.test(currentUrl))) {
          highPriorityQueue.push(currentUrl);
          processedUrls.set(currentUrl, { hasEmails: false, priority: 2 });
          console.log(`  ⭐ HIGH PRIORITY PAGE IDENTIFIED: ${currentUrl}`);
        } else {
          regularQueue.push(currentUrl);
          processedUrls.set(currentUrl, { hasEmails: false, priority: 1 });
        }
        
        // Quick scan for emails on critical pages
        if (isCritical) {
          const quickEmailScan = extractEmails(html, currentUrl);
          if (quickEmailScan.length > 0) {
            console.log(`  📧 ${quickEmailScan.length} emails detected on critical page during mapping`);
            processedUrls.set(currentUrl, { 
              hasEmails: true, 
              priority: processedUrls.get(currentUrl).priority + 1 
            });
            
            // Add HR emails to our collection immediately
            for (const item of quickEmailScan) {
              if (item.isHrRelated) {
                const lowerCaseEmail = item.email.toLowerCase();
                if (!uniqueEmails.has(lowerCaseEmail)) {
                  uniqueEmails.set(lowerCaseEmail, { 
                    count: 1, 
                    sources: new Set([currentUrl]) 
                  });
                  foundEmails.push(item);
                  totalEmailsFound++;
                }
              }
            }
          }
        }
        
        // Extract links more efficiently
        let links = extractLinks(html, currentUrl);
        
        // Apply additional filtering for discovery to save memory
        links = links.filter(link => {
          try {
            const linkUrl = new URL(link);
            const linkPath = linkUrl.pathname.toLowerCase();
            
            // Skip URLs with excluded extensions
            if (excludedExtensions.some(ext => linkPath.endsWith(ext))) {
              return false;
            }
            
            // Skip URLs with excluded patterns
            if (excludedPatterns.some(pattern => linkPath.includes(pattern))) {
              return false;
            }
            
            return true;
          } catch (e) {
            return false;
          }
        });
        
        // Memory optimization: limit discovery breadth
        const maxLinksPerPage = 20;
        links = links.slice(0, maxLinksPerPage);
        
        // Add new links to the discovery queue (prioritizing potential critical pages)
        for (const link of links) {
          if (!processedUrls.has(link) && !urlsToDiscover.includes(link)) {
            // Prioritize potential career/jobs pages in the discovery queue
            if (criticalPagePatterns.some(pattern => pattern.test(link))) {
              urlsToDiscover.unshift(link); // Add to front
            } else {
              urlsToDiscover.push(link); // Add to back
            }
          }
        }
      }
      
      // Force garbage collection between batches
      console.log(`Memory cleanup after batch. Queues: Critical=${criticalQueue.length}, High=${highPriorityQueue.length}, Regular=${regularQueue.length}`);
      global.gc && global.gc();
    }
    
    console.log('='.repeat(50));
    console.log(`PHASE 1 COMPLETE: Found ${criticalQueue.length} critical pages, ${highPriorityQueue.length} high-value pages, ${regularQueue.length} regular pages`);
    console.log(`${[...processedUrls.entries()].filter(([_, data]) => data.hasEmails).length} pages were detected to contain email addresses`);
    console.log('='.repeat(50));
    
    // PHASE 2: OPTIMIZED EMAIL EXTRACTION WITH MEMORY MANAGEMENT
    console.log('='.repeat(50));
    console.log('PHASE 2: OPTIMIZED EMAIL EXTRACTION');
    console.log('='.repeat(50));
    
    // Prepare prioritized URL list for processing with strict limits
    const allPrioritizedUrls = [
      // Critical pages first (career/jobs focused)
      ...criticalQueue,
      // Then high-value pages (contact, about, etc)
      ...highPriorityQueue,
      // Then regular pages with a much stricter limit
      ...regularQueue.slice(0, Math.min(regularQueue.length, effectiveMaxPages - criticalQueue.length - highPriorityQueue.length))
    ];
    
    // Respect the maximum page limit
    const urlsToProcess = allPrioritizedUrls.slice(0, effectiveMaxPages);
    
    console.log(`Will process ${criticalQueue.length} critical, ${highPriorityQueue.length} high-value, and ${urlsToProcess.length - criticalQueue.length - highPriorityQueue.length} other pages (${urlsToProcess.length} total)`);
    
    let pagesScanned = 0;
    let hrEmailsFound = 0;
    let potentialHrEmails = 0;
    
    // Dynamic HR detection improvements with memory efficiency
    let knownHrDomains = new Set();
    let commonEmailPrefixes = new Set();
    
    // Process in smaller batches to optimize memory usage
    const batchSize = 5;
    for (let i = 0; i < urlsToProcess.length; i += batchSize) {
      const batch = urlsToProcess.slice(i, i + batchSize);
      
      // Process each URL in the current batch
      for (const currentUrl of batch) {
        // Skip if this URL has already been processed
        if (processedUrls.get(currentUrl)?.processed) {
          continue;
        }
        
        // Mark as processed
        processedUrls.set(currentUrl, { 
          ...processedUrls.get(currentUrl), 
          processed: true 
        });
        
        pagesScanned++;
        
        // Determine page priority for logging
        let pageType = "Regular";
        let priority = processedUrls.get(currentUrl)?.priority || 0;
        
        if (priority === 3) pageType = "⭐ CRITICAL";
        else if (priority === 2) pageType = "🔍 HIGH VALUE";
        else if (processedUrls.get(currentUrl)?.hasEmails) pageType = "📧 HAS EMAILS";
        
        console.log(`[${pagesScanned}/${urlsToProcess.length}] ${pageType}: ${currentUrl}`);
        
        // Dynamic delay based on page importance to avoid rate limiting
        const delay = priority >= 2 ? 200 : 300;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Fetch with more retries for important pages
        const retries = priority >= 2 ? 3 : 1;
        const html = await fetchPage(currentUrl, retries);
        
        if (!html) {
          errors.push(`Failed to fetch: ${currentUrl}`);
          continue;
        }
        
        // Enhanced email extraction
        const emailsOnPage = extractEmails(html, currentUrl);
        
        if (emailsOnPage.length > 0) {
          // Process each email with dynamic classification improvements
          let newHrEmails = 0;
          let newPotentialEmails = 0;
          
          for (const item of emailsOnPage) {
            const lowerCaseEmail = item.email.toLowerCase();
            
            // Skip if this exceeds our maximum collection size to prevent memory issues
            if (foundEmails.length >= 1000) {
              console.log(`  ⚠️ Email collection cap reached (1000). Skipping additional emails.`);
              break;
            }
            
            // Memory optimization: Check if we've already seen this email
            if (uniqueEmails.has(lowerCaseEmail)) {
              const emailData = uniqueEmails.get(lowerCaseEmail);
              emailData.count++;
              emailData.sources.add(currentUrl);
              continue;
            }
            
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
            
            // Track this email
            uniqueEmails.set(lowerCaseEmail, { 
              count: 1, 
              sources: new Set([currentUrl]) 
            });
            
            // Process and store HR-related emails
            if (item.isHrRelated) {
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
          if (newHrEmails > 0 || newPotentialEmails > 0) {
            console.log(`  Found ${newHrEmails} new HR email(s) and reclassified ${newPotentialEmails} as potential HR emails`);
          }
        }
        
        // Progress report with enhanced statistics
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        const pagesPerSecond = (pagesScanned / elapsedSeconds).toFixed(2);
        console.log(`  Progress: ${pagesScanned}/${urlsToProcess.length} pages | ${hrEmailsFound} HR emails | ${potentialHrEmails} potential HR emails | ${emailsStoredInDb} stored in DB | ${pagesPerSecond} p/s`);
      }
      
      // Force garbage collection between batches
      console.log(`Memory cleanup after batch ${Math.ceil(i/batchSize)}/${Math.ceil(urlsToProcess.length/batchSize)}.`);
      global.gc && global.gc();
    }
    
    // Final scan report with detailed statistics
    const totalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    console.log('='.repeat(50));
    console.log('ULTRA-POWERFUL SCAN COMPLETED');
    console.log('='.repeat(50));
    console.log(`Total pages scanned: ${pagesScanned}`);
    console.log(` - Critical pages: ${criticalQueue.length}`);
    console.log(` - High-value pages: ${highPriorityQueue.length}`);
    console.log(` - Regular pages: ${pagesScanned - criticalQueue.length - highPriorityQueue.length}`);
    console.log(`Total HR emails found: ${hrEmailsFound}`);
    console.log(`Additional potential HR emails identified: ${potentialHrEmails}`);
    console.log(`Total emails stored in database: ${emailsStoredInDb}`);
    console.log(`Scan duration: ${totalTimeSeconds} seconds`);
    console.log(`Pages per second: ${(pagesScanned / totalTimeSeconds).toFixed(2)}`);
    
    if (errors.length > 0) {
      console.log(`Errors encountered: ${errors.length}`);
    }
    
    console.log('='.repeat(50));
    
    // Memory-efficient analytics
    const emailsByDomain = {};
    const emailsByPattern = {};
    
    // Limit the analysis to avoid memory pressure
    const analysisLimit = Math.min(foundEmails.length, 500);
    
    for (let i = 0; i < analysisLimit; i++) {
      const item = foundEmails[i];
      const [localPart, domain] = item.email.toLowerCase().split('@');
      
      // Group by domain
      if (!emailsByDomain[domain]) {
        emailsByDomain[domain] = [];
      }
      if (emailsByDomain[domain].length < 20) { // Limit per domain
        emailsByDomain[domain].push(item.email);
      }
      
      // Group by pattern
      const prefix = localPart.match(/^[a-z]+/i)?.[0] || 'other';
      if (!emailsByPattern[prefix]) {
        emailsByPattern[prefix] = [];
      }
      if (emailsByPattern[prefix].length < 20) { // Limit per pattern
        emailsByPattern[prefix].push(item.email);
      }
    }
    
    // Return comprehensive results with memory optimization
    return res.json({ 
      success: true,
      stats: {
        pagesScanned,
        criticalPagesScanned: criticalQueue.length,
        highValuePagesScanned: highPriorityQueue.length,
        regularPagesScanned: pagesScanned - criticalQueue.length - highPriorityQueue.length,
        totalHrEmailsFound: hrEmailsFound,
        potentialHrEmailsFound: potentialHrEmails,
        emailsStoredInDb,
        scanDurationSeconds: totalTimeSeconds,
        memoryOptimized: true
      },
      // Limit result size to prevent large payloads
      emailDetails: foundEmails.slice(0, 100), // Only return first 100 for API response
      emailsByDomain,
      emailsByPattern,
      errors: errors.length > 0 ? errors.slice(0, 50) : undefined // Limit error reporting
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

// Add memory optimization middleware
app.use((req, res, next) => {
  // Force garbage collection if available (requires --expose-gc flag)
  if (global.gc) {
    global.gc();
    console.log('Garbage collection forced before request processing');
  }
  next();
});

// Status endpoint to check if server is running with memory usage info
app.get('/status', (req, res) => {
  const memoryUsage = process.memoryUsage();
  
  return res.json({
    status: 'running',
    memory: {
      rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB`
    },
    uptime: `${(process.uptime() / 60).toFixed(2)} minutes`
  });
});
// Register the bulk scraper routes
app.use(bulkScraper);

// Start the server
app.listen(PORT, () => {
  console.log(`Email scraper server running on port ${PORT}`);
  console.log(`Server ready to scan websites for emails and store them in Supabase`);
});
