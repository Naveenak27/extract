const axios = require('axios');
const cheerio = require('cheerio');

// Improved email extraction with expanded HR classification and duplicate prevention
// Modified extractEmails function to capture ALL emails, not just HR-related ones
const extractEmails = (html, pageUrl) => {
  // Higher precision email regex to reduce false positives
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;
  
  // Extended HR-related keywords for better classification
  const hrKeywords = [
    // Basic HR terms
    'hr', 'human', 'resource', 'career', 'job', 'recruit', 'hiring',
    'apply', 'resume', 'cv', 'talent', 'position', 'employment',
    'hr', 'human', 'resource', 'humanresource', 'humanresources', 'h.r', 'h-r', 'h_r',
    
    // Recruiting and hiring
    'career', 'careers', 'job', 'jobs', 'vacancy', 'vacancies', 'opening', 'openings',
    'recruit', 'recruiter', 'recruiting', 'recruitment', 'talent', 'talents', 'talentacquisition',
    'hiring', 'hire', 'onboarding', 'staffing', 'personnel',
    
    // Application related
    'apply', 'application', 'applicant', 'candidate', 'candidates', 'resume', 'resumes', 'cv',
    
    // Position types
    'position', 'employment', 'intern', 'internship', 'jobopportunity',
    
    
    // Departments and roles
    'placement', 'payroll', 'compensation', 'benefits', 'training', 'development',
    'workforce', 'workday', 'employee', 'employer', 'staff', 'talent', 'people', 'peopleops',
    
    // Common HR email prefixes
    'jobs', 'work', 'career', 'careers', 'jobopportunities', 'joboffer', 'joboffers',
    'join', 'joinus', 'hiringteam', 'hiringmanager', 'talentteam', 'talentacquisition',
    'recruitment', 'recruiting', 'opportunities', 'opportunity', 'employ', 'employment',
    'employer', 'jobportal', 'jobboard', 'careerportal', 'careerpage', 'jobsearch',
    
    // Generic business contact that may handle job inquiries
    'info', 'information', 'contact', 'contactus', 'hello', 'admin', 'administrator',
    
    // Department specific
    'corporate', 'headquarters', 'hq', 'office', 'enquiry', 'inquiry', 'general',
    
    // Application portal related
    'applications', 'applicants', 'apply-now', 'applynow', 'jobapp', 'jobapplication',
    
    // Common formats
    'cv-submission', 'cvsubmission', 'resume-submission', 'resumesubmission'
  ];
  
  // Process html in chunks to avoid regex memory issues on large pages
  const chunkSize = 100000; // 100KB chunks
  const emailSet = new Set();
  
  for (let i = 0; i < html.length; i += chunkSize) {
    const chunk = html.slice(i, i + chunkSize);
    const chunkEmails = chunk.match(emailRegex) || [];
    chunkEmails.forEach(email => emailSet.add(email));
  }
  
  // Convert to array and remove duplicates
  let allEmails = [...emailSet]; 
  
  // Parse HTML for context analysis - using more efficient selectors
  // Load with lower memory usage options
  const $ = cheerio.load(html, {
    normalizeWhitespace: true,
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true
  });
  
  // Store emails with their context
  const emailDetails = [];
  
  // Process each found email
  allEmails.forEach(email => {
    // Check if email appears in an HR-related context (for classification only)
    let isHrRelated = false;
    let context = '';
    let confidenceScore = 0; // Track confidence in HR classification
    
    // First, check email prefix for HR keywords (high confidence indicator)
    const localPart = email.split('@')[0].toLowerCase();
    
    // Check for exact HR email patterns (highest confidence)
    const commonHrPatterns = [
      /^jobs@/i, /^careers@/i, /^hr@/i, /^recruiting@/i, /^recruitment@/i,
      /^apply@/i, /^applications@/i, /^resumes?@/i, /^cv@/i, /^talent@/i,
      /^employment@/i, /^hiringteam@/i, /^joinus@/i
    ];
    
    if (commonHrPatterns.some(pattern => pattern.test(email))) {
      isHrRelated = true;
      confidenceScore += 5;
    }
    
    // Check local part against hr keywords
    if (hrKeywords.some(keyword => localPart === keyword)) {
      isHrRelated = true;
      confidenceScore += 4;
    }
    
    // Check if local part contains hr keywords
    if (hrKeywords.some(keyword => localPart.includes(keyword))) {
      isHrRelated = true;
      confidenceScore += 2;
    }
    
    // Additional check for numeric-suffixed HR emails
    const hrWithNumberPattern = /^(hr|recruit|career|job|talent|apply|hiring)\d+@/i;
    if (hrWithNumberPattern.test(email)) {
      isHrRelated = true;
      confidenceScore += 3;
    }
    
    // Look for context in surrounding text - more efficient approach
    // Find elements containing this email and get their context
    try {
      // More targeted search to improve performance
      const selector = `a[href^="mailto:${email}"], a:contains("${email}"), p:contains("${email}"), div:contains("${email}")`;
      
      $(selector).each((_, element) => {
        // Get text from this element or its parent, whichever is shorter but meaningful
        const elementText = $(element).text().trim();
        const parentText = $(element).parent().text().trim();
        
        let contextText = elementText.length < parentText.length && elementText.length > 20 
          ? elementText 
          : parentText;
          
        // Limit context length to avoid memory issues
        contextText = contextText.substring(0, 300);
        
        if (contextText && (!context || contextText.length < context.length)) {
          context = contextText;
          
          // Check if context contains HR keywords
          const hrKeywordCount = hrKeywords.filter(keyword => 
            contextText.toLowerCase().includes(keyword)
          ).length;
          
          if (hrKeywordCount > 0) {
            isHrRelated = true;
            confidenceScore += Math.min(hrKeywordCount, 3); // Cap at 3 points
          }
        }
      });
    } catch (e) {
      // If cheerio selector throws an error, fallback to simpler approach
      context = 'Context extraction failed';
    }
    
    // If the page URL itself contains HR patterns, increase confidence
    if (criticalPagePatterns.some(pattern => pattern.test(pageUrl))) {
      confidenceScore += 2;
      if (!isHrRelated && confidenceScore >= 2) {
        isHrRelated = true;
      }
    }
    
    // Add ALL emails to the results with classification score
    emailDetails.push({
      email,
      isHrRelated,
      confidenceScore,
      context: context || 'No context found',
      foundOn: pageUrl
    });
  });
  
  return emailDetails;
};
// Extract all links from a page
const extractLinks = (html, baseUrl) => {
  const $ = cheerio.load(html);
  const links = new Set();
  
  // Expanded list of file extensions to skip
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
    '/blog/', '/news/', '/article/', '/press/', '/media/',
    '/gallery/', '/photos/', '/images/', '/video/', '/download/',
    '/privacy/', '/terms/', '/policy/', '/legal/', '/cookie/',
    '/sitemap/', '/rss/', '/feed/', '/api/', '/wp-content/',
    '/wp-includes/', '/wp-admin/', '/wp-json/', '/admin/',
    '/assets/', '/static/', '/dist/', '/build/', '/node_modules/',
    '/archive/', '/tag/', '/category/', '/author/', '/search/',
    '/login/', '/register/', '/shop/', '/product/', '/cart/'
  ];
  
  $('a').each((_, element) => {
    let href = $(element).attr('href');
    if (!href) return;
    
    // Clean the URL
    href = href.split('#')[0]; // Remove hash fragments
    if (!href) return;
    
    try {
      // Convert relative URLs to absolute
      const absoluteUrl = new URL(href, baseUrl).href;
      
      // Only include links from the same domain
      const url = new URL(absoluteUrl);
      const baseHostname = new URL(baseUrl).hostname;
      
      if (url.hostname === baseHostname) {
        const path = url.pathname.toLowerCase();
        
        // Skip files with excluded extensions
        if (excludedExtensions.some(ext => path.endsWith(ext))) {
          return;
        }
        
        // Skip URLs with excluded patterns
        if (excludedPatterns.some(pattern => path.includes(pattern))) {
          return;
        }
        
        links.add(absoluteUrl);
      }
    } catch (e) {
      // Invalid URL, skip
    }
  });
  
  return [...links];
};
const fetchPage = async (url, retries = 2, maxSizeBytes = 5 * 1024 * 1024) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching: ${url} (Attempt ${attempt + 1}/${retries + 1})`);
      
      // First, make a HEAD request to check content type and size
      const headResponse = await axios.head(url, { 
        timeout: 10000, // 10 seconds timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        maxRedirects: 5
      });
      
      // Check content type - only proceed with HTML/text content
      const contentType = headResponse.headers['content-type'] || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        console.log(`Skipping non-HTML content: ${url} (${contentType})`);
        return null;
      }
      
      // Check content length if available
      const contentLength = parseInt(headResponse.headers['content-length'] || '0', 10);
      if (contentLength > maxSizeBytes && contentLength !== 0) {
        console.log(`Skipping large page: ${url} (${(contentLength/1024/1024).toFixed(2)} MB)`);
        return null;
      }
      
      // If all checks pass, proceed with GET request
      const response = await axios.get(url, { 
        timeout: 15000, // 15 seconds timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0'
        },
        maxRedirects: 5,
        responseType: 'text',
        maxContentLength: maxSizeBytes, // Limit response size to prevent memory issues
        maxBodyLength: maxSizeBytes
      });
      
      // Final check on actual content
      if (!response.headers['content-type']?.includes('text/html') && 
          !response.headers['content-type']?.includes('application/xhtml+xml')) {
        console.log(`Received non-HTML content despite HEAD check: ${url}`);
        return null;
      }
      
      return response.data;
    } catch (error) {
      let errorMsg;
      
      if (error.code === 'ECONNABORTED') {
        errorMsg = `Timeout fetching ${url}`;
      } else if (error.response) {
        errorMsg = `Error fetching ${url}: HTTP status ${error.response.status}`;
      } else if (error.request) {
        errorMsg = `Error fetching ${url}: No response received`;
      } else {
        errorMsg = `Error fetching ${url}: ${error.message}`;
      }
      
      console.log(`${errorMsg} (Attempt ${attempt + 1}/${retries + 1})`);
      
      if (attempt === retries) {
        return null;
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  
  return null;
};
// Prioritize URLs based on job relevance
const prioritizeUrls = (urls) => {
  const criticalPriority = []; // New top priority category
  const highPriority = [];
  const mediumPriority = [];
  const lowPriority = [];
  
  // Extended Critical priority patterns - career/jobs pages that MUST be checked
  const criticalPriorityPatterns = [
    // Career/jobs pages
    /careers?\/?$|careers?\/.*|jobs?\/?$|jobs?\/.*|work.*?with.*?us\/?$|join.*?us\/?$/i,
    /employment\/?$|employment\/.*|vacancies\/?$|openings\/?$/i,
    /careers?\.html|jobs?\.html|careers?\.php|jobs?\.php/i,
    /positions?\/?$|positions?\/.*|opportunities\/?$/i,
    /apply(-|_|\.)now|jointeam|joinus|applyhere/i,
    
    // Application-specific pages
    /apply\/?$|apply\/.*|application\/?$|application\/.*/i
  ];
  
  // Extended High priority patterns - likely to contain job info
  const highPriorityPatterns = [
    // Recruiting terms
    /recruit|hiring|talent|staffing|placement/i,
    
    // Specific job terms
    /position|vacancy|opening|internship/i,
    
    // Application process terms
    /apply|application|resume|cv/i,
    
    // HR pages
    /hr\/?$|human-?resources\/?$/i
  ];
  
  // Extended Medium priority patterns - might contain contact info for HR
  const mediumPriorityPatterns = [
    /contact|contactus|contact-us|about-us|aboutus|about|team|people|staff|directory|department/i,
    /locations|offices|headquarters|hq/i
  ];
  
  // Extended patterns to completely avoid
  const avoidPatterns = [
    // Media and resources that rarely contain HR contact info
    /press-?release|news|blog|article|podcast|webinar|whitepaper/i,
    
    // Technical areas
    /documentation|manual|guide|tutorial|faq|help/i,
    
    // Customer areas
    /support|service|ticket|knowledge-?base/i,
    
    // Marketing areas
    /testimonial|casestudy|success-?story/i,
    
    // Product areas
    /product|feature|solution|platform|technology/i,
    
    // Shopping
    /shop|store|cart|checkout|order|payment|pricing/i,
    
    // User account areas
    /login|signin|signup|register|account|profile|dashboard|preferences/i,
    
    // Legal pages
    /terms|privacy|legal|policy|cookie|gdpr|copyright/i,
    
    // Navigation
    /sitemap|search|404|error/i,
    
    // Calendar/events
    /event|calendar|schedule|agenda|conference|webinar|workshop|meetup/i
  ];
  
  urls.forEach((url) => {
    // Check if URL should be completely avoided
    if (avoidPatterns.some(pattern => pattern.test(url))) {
      return; // Skip this URL entirely
    }
    
    // Check critical patterns first
    if (criticalPriorityPatterns.some(pattern => pattern.test(url))) {
      criticalPriority.push(url);
    } else if (highPriorityPatterns.some(pattern => pattern.test(url))) {
      highPriority.push(url);
    } else if (mediumPriorityPatterns.some(pattern => pattern.test(url))) {
      mediumPriority.push(url);
    } else {
      lowPriority.push(url);
    }
  });
  
  // Return URLs with critical priority first, but limit the total URLs to save memory
  return [...criticalPriority, ...highPriority, ...mediumPriority, ...lowPriority.slice(0, 100)];
};
// Add this function to your scraper-utils.js file

/**
/**
 * Stores an email in the Supabase database
 * @param {Object} supabase - Supabase client instance
 * @param {Object} emailData - Email data object to store
 * @param {string} emailData.email - The email address
 * @param {string} emailData.source - The source URL where the email was found
 * @param {string} [emailData.context] - Optional context around where the email was found
 * @param {boolean} [emailData.isHrRelated] - Whether the email appears to be HR-related
 * @returns {Promise<Object>} - Result of the database operation
 */
const storeEmailInSupabase = async (supabase, emailData) => {
  try {
    // Check if email already exists to avoid duplicates
    const { data: existingEmails, error: queryError } = await supabase
      .from('emails')
      .select('id')
      .eq('email', emailData.email.toLowerCase());
    
    if (queryError) {
      console.error('Error checking for existing email:', queryError);
      throw queryError;
    }
    
    // If email already exists, don't insert again
    if (existingEmails && existingEmails.length > 0) {
      console.log(`Email already exists: ${emailData.email}`);
      return { success: true, status: 'exists', id: existingEmails[0].id };
    }
    
    // Insert the new email with all metadata
    const { data, error } = await supabase
      .from('emails')
      .insert([
        {
          email: emailData.email.toLowerCase(),
          source_url: emailData.source,
          context: emailData.context || null,
          is_hr_related: emailData.isHrRelated || false, // Store HR classification
          active: 1,
          discovered_at: new Date().toISOString() // Add timestamp of discovery
        }
      ])
      .select();
    
    if (error) {
      console.error('Error storing email in Supabase:', error);
      throw error;
    }
    
    console.log(`Successfully stored email in database: ${emailData.email}`);
    return { success: true, status: 'inserted', data };
  } catch (error) {
    console.error('Failed to store email:', error);
    // Return false but don't throw to avoid stopping the scraping process
    return { success: false, error: error.message };
  }
};module.exports = {
    storeEmailInSupabase,
  extractEmails,
  extractLinks,
  fetchPage,
  prioritizeUrls
};
