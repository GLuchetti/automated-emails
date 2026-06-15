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

// Email addresses
export const SUPPORT_FROM_EMAIL = "support@sitezeus.com";
export const INTERNAL_NOTIFICATION_EMAIL = "support@sitezeus.com";
export const SITEZEUS_DOMAIN = "sitezeus.com";

// Resource links — topics[] matched against Gong tracker names (lowercase)
export const ENTERPRISE_RESOURCES = [
  {
    name: "White Space Analysis",
    url: "https://sitezeus.com/products/site-selection-software",
    topics: ["white space", "whitespace", "gap analysis", "untapped", "growth opportunity"],
  },
  {
    name: "Sales Forecasting",
    url: "https://sitezeus.com/products/site-selection-software",
    topics: ["forecast", "sales forecast", "revenue forecast", "projection", "predict"],
  },
  {
    name: "Sales Impact",
    url: "https://sitezeus.com/products/site-selection-software",
    topics: ["sales impact", "cannibalization", "roi", "revenue impact", "performance"],
  },
  {
    name: "Customer Insights",
    url: "https://sitezeus.com/products/customer-insights-platform",
    topics: ["market", "customer insights", "trade area", "mobile data", "competition", "competitor"],
  },
  {
    name: "Zeus AI",
    url: "https://sitezeus.com/products/site-selection-software",
    topics: ["zeus ai", "zeus", "ai", "artificial intelligence", "predictive", "machine learning"],
  },
  {
    name: "SiteZeus Build",
    url: "https://sitezeus.com/products/construction-management-software",
    topics: ["build", "construction", "unit opening", "new location", "expansion", "open", "growth"],
  },
  {
    name: "SiteZeus Sell",
    url: "https://sitezeus.com/products/franchise-crm",
    topics: ["sell", "franchise crm", "pipeline", "franchise sales", "disposition", "portfolio"],
  },
  {
    name: "Proof of Concept",
    url: "https://sitezeus.com/schedule-a-demo",
    topics: ["poc", "proof of concept", "pilot", "test", "trial"],
  },
];

export const SMB_EMERGING_RESOURCES = [
  {
    name: "SiteZeus Locate",
    url: "https://sitezeus.com/products/site-selection-software",
    topics: ["emerging", "site selection", "small business", "franchise", "growing", "startup", "locate"],
  },
  {
    name: "SiteZeus Build",
    url: "https://sitezeus.com/products/construction-management-software",
    topics: ["build", "construction", "unit opening", "new location", "expansion", "open", "growth"],
  },
  {
    name: "SiteZeus Sell",
    url: "https://sitezeus.com/products/franchise-crm",
    topics: ["sell", "franchise crm", "pipeline", "franchise sales", "disposition", "portfolio"],
  },
  {
    name: "Customer Insights",
    url: "https://sitezeus.com/products/customer-insights-platform",
    topics: ["market", "customer insights", "trade area", "mobile data", "competition", "competitor"],
  },
];

export const CUSTOMER_STORIES_URL = "https://sitezeus.com/customer-stories";
