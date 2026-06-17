// =============================================================
// config.js — SiteZeus Gong Email Automation
// Update these values before deploying.
// =============================================================

// Team identification — Manager names exactly as they appear in Gong
export const SALES_MANAGER_NAME = "Ian Walsh";
export const SUPPORT_MANAGER_NAME = "Olivia Bolton";

// Sales reps — keys must match Gong email addresses exactly
export const SALES_REPS = {
  "emma.keeney@sitezeus.com": "Emma Keeney",
  "lucas.boney@sitezeus.com": "Lucas Boney",
  "mitchg@sitezeus.com": "Mitchell Gunderson",
  "william.morgan@sitezeus.com": "William Morgan",
};

// Enterprise classification — HubSpot property + threshold
export const ENTERPRISE_UNIT_COUNT_PROPERTY = "unit_count";
export const ENTERPRISE_THRESHOLD = 50; // >= 50 units → Enterprise

// ------------------------------------------------------------------
// Transcript-timing safety
// Gong needs time to transcribe a call after it ends. Each run scans
// back LOOKBACK_HOURS and only emails a call once its transcript is
// actually available. A call whose transcript still hasn't appeared
// after TRANSCRIPT_CUTOFF_HOURS is sent on the Gong-summary fallback
// so it can never wait forever. Already-emailed calls are tracked in
// state/processed_calls.json so they are never sent twice.
// ------------------------------------------------------------------
export const LOOKBACK_HOURS = 8;          // how far back each run scans for calls
export const TRANSCRIPT_CUTOFF_HOURS = 6; // give up waiting → send on fallback

// Email addresses
export const SUPPORT_FROM_EMAIL = "support@sitezeus.com";
export const INTERNAL_NOTIFICATION_EMAIL = "support@sitezeus.com";
export const SITEZEUS_DOMAIN = "sitezeus.com";

// ------------------------------------------------------------------
// Resources — matched against AI-extracted topics from the transcript.
// Each entry has topics[] for keyword matching (lowercase).
// Resources are intelligently selected per call based on what the
// prospect showed genuine interest in.
// ------------------------------------------------------------------

// Core product pages
const PRODUCT_RESOURCES = [
  {
    name: "SiteZeus Locate — Site Selection",
    url: "https://sitezeus.com/products/site-selection-software",
    topics: ["site selection", "locate", "forecast", "revenue forecast", "location scoring", "predict", "ai score"],
  },
  {
    name: "Customer Insights — Market Intelligence",
    url: "https://sitezeus.com/products/customer-insights-platform",
    topics: ["customer insights", "market", "trade area", "mobile data", "consumer", "demographics", "competition", "competitor"],
  },
  {
    name: "SiteZeus Build — Construction Management",
    url: "https://sitezeus.com/products/construction-management-software",
    topics: ["build", "construction", "construction management", "unit opening", "new location", "buildout", "milestone", "timeline", "project management"],
  },
  {
    name: "SiteZeus Sell — Franchise CRM",
    url: "https://sitezeus.com/products/franchise-crm",
    topics: ["sell", "franchise crm", "pipeline", "franchise sales", "candidate", "territory", "disposition", "portfolio"],
  },
  {
    name: "Zeus AI — Predictive Intelligence",
    url: "https://sitezeus.com/products/site-selection-software",
    topics: ["zeus ai", "zeus", "ai", "artificial intelligence", "predictive", "machine learning", "recommendation"],
  },
];

// Content resources — blogs, webinars, client stories by topic
const CONTENT_RESOURCES = [
  {
    name: "White Space Analysis Guide",
    url: "https://sitezeus.com/blog/white-space-analysis",
    topics: ["white space", "whitespace", "gap analysis", "untapped market", "expansion opportunity", "growth opportunity", "new market entry"],
  },
  {
    name: "Restaurant Expansion Planning",
    url: "https://sitezeus.com/blog/restaurant-expansion-planning",
    topics: ["restaurant expansion", "expansion planning", "franchise expansion", "expanding", "growth strategy", "franchise growth"],
  },
  {
    name: "Site Selection Checklist",
    url: "https://sitezeus.com/blog/site-selection-checklist",
    topics: ["site selection checklist", "evaluating locations", "location criteria", "site criteria", "site evaluation"],
  },
  {
    name: "Sales Impact & Cannibalization",
    url: "https://sitezeus.com/blog/cannibalization-analysis",
    topics: ["sales impact", "cannibalization", "overlap", "transfer", "roi", "impact analysis", "proximity"],
  },
  {
    name: "Franchise Growth Webinar",
    url: "https://sitezeus.com/webinars",
    topics: ["franchise", "franchise system", "franchisee", "franchisor", "franchise development", "multi-unit"],
  },
  {
    name: "Customer Stories",
    url: "https://sitezeus.com/customer-stories",
    topics: ["case study", "results", "success", "customer story", "client story", "proof", "roi"],
  },
  {
    name: "Proof of Concept / Demo",
    url: "https://sitezeus.com/schedule-a-demo",
    topics: ["poc", "proof of concept", "pilot", "trial", "test", "demo", "sandbox"],
  },
];

// Combined pool for resource selection
export const ENTERPRISE_RESOURCES = [...PRODUCT_RESOURCES, ...CONTENT_RESOURCES];
export const SMB_EMERGING_RESOURCES = [...PRODUCT_RESOURCES, ...CONTENT_RESOURCES];

export const CUSTOMER_STORIES_URL = "https://sitezeus.com/customer-stories";
