const axios = require('axios');
const cheerio = require('cheerio');

// Improved email extraction with expanded HR classification and duplicate prevention
// Modified extractEmails function to capture ALL emails, not just HR-related ones
const extractEmails = (html, pageUrl) => {
  // Regular expression for email detection
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  
  // HR-related keywords are kept for classification purposes only
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
  
  // Extract all emails
  let allEmails = html.match(emailRegex) || [];
  allEmails = [...new Set(allEmails)]; // Remove duplicates
  
  // Parse HTML for context analysis
  const $ = cheerio.load(html);
  
  // Store emails with their context
  const emailDetails = [];
  
  // Process each found email
  allEmails.forEach(email => {
    // Check if email appears in an HR-related context (for classification only)
    let isHrRelated = false;
    let context = '';
    
    // Look for elements containing this specific email
    $(`*:contains("${email}")`).each((_, element) => {
      const parentText = $(element).parent().text().trim();
      if (parentText.length > 0 && parentText.length < 500) {
        context = parentText;
        
        // Check if context contains HR keywords (for classification only)
        if (hrKeywords.some(keyword => parentText.toLowerCase().includes(keyword))) {
          isHrRelated = true;
        }
      }
    });
    
    // Check email prefix for HR keywords (for classification only)
    const localPart = email.split('@')[0].toLowerCase();
    if (hrKeywords.some(keyword => localPart.includes(keyword))) {
      isHrRelated = true;
    }
    
    // Common HR email pattern checks (for classification only)
    const commonHrPatterns = [
      /^jobs@/i, /^careers@/i, /^hr@/i, /^recruiting@/i, /^recruitment@/i,
      /^apply@/i, /^applications@/i, /^resumes?@/i, /^cv@/i, /^talent@/i,
      /^employment@/i, /^hiringteam@/i, /^joinus@/i
    ];
    
    if (commonHrPatterns.some(pattern => pattern.test(email))) {
      isHrRelated = true;
    }
    
    // Additional check for numeric-suffixed HR emails (for classification only)
    const hrWithNumberPattern = /^(hr|recruit|career|job|talent|apply|hiring)\d+@/i;
    if (hrWithNumberPattern.test(email)) {
      isHrRelated = true;
    }
    
    // Add ALL emails to the results (not just HR-related ones)
    emailDetails.push({
      email,
      isHrRelated, // Keep the classification for filtering options later
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
  
  $('a').each((_, element) => {
    let href = $(element).attr('href');
    if (!href) return;
    
    // Clean the URL
    href = href.split('#')[0]; // Remove hash fragments
    if (!href) return;
    
    try {
      // Convert relative URLs to absolute
      const absoluteUrl = new URL(href, baseUrl).href;
      
      // Only include links from the same domain and valid extensions
      const url = new URL(absoluteUrl);
      const baseHostname = new URL(baseUrl).hostname;
      
      if (url.hostname === baseHostname) {
        // Skip file downloads and other non-HTML resources
        const path = url.pathname.toLowerCase();
        if (path.endsWith('.pdf') || path.endsWith('.doc') || path.endsWith('.docx') || 
            path.endsWith('.jpg') || path.endsWith('.png') || path.endsWith('.zip') ||
            path.endsWith('.mp4') || path.endsWith('.mp3')) {
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

// Improved page fetcher with retry logic
const fetchPage = async (url, retries = 2) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching: ${url} (Attempt ${attempt + 1}/${retries + 1})`);
      
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
        maxRedirects: 5
      });
      
      return response.data;
    } catch (error) {
      const errorMsg = error.code === 'ECONNABORTED' 
        ? `Timeout fetching ${url}` 
        : `Error fetching ${url}: ${error.message}`;
      
      console.log(`${errorMsg} (Attempt ${attempt + 1}/${retries + 1})`);
      
      if (attempt === retries) {
        return null;
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
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
  
  // Critical priority patterns - career/jobs pages that MUST be checked
  const criticalPriorityPatterns = [
    /careers?\/?$|careers?\/.*|jobs?\/?$|jobs?\/.*|work.*?with.*?us\/?$|join.*?us\/?$/i,
    /employment\/?$|employment\/.*|vacancies\/?$|openings\/?$/i,
    /careers?\.html|jobs?\.html|careers?\.php|jobs?\.php/i
  ];
  
  // High priority patterns - likely to contain job info
  const highPriorityPatterns = [
    /recruit|hiring|apply|application|vacancy|position/i
  ];
  
  // Medium priority patterns - might contain contact info for HR
  const mediumPriorityPatterns = [
    /contact|about.*?us|team|people|staff|directory|department/i
  ];
  
  urls.forEach(url => {
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
  
  // Return URLs with critical priority first
  return [...criticalPriority, ...highPriority, ...mediumPriority, ...lowPriority];
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
