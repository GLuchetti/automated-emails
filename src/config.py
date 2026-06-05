# =============================================================
# config.py — SiteZeus Gong Email Automation
# Update these values before deploying.
# =============================================================

# -------------------------------------------------------------
# TEAM IDENTIFICATION
# Manager names exactly as they appear in Gong (First Last)
# -------------------------------------------------------------
SALES_MANAGER_NAME = "Ian Walsh"
SUPPORT_MANAGER_NAME = "Olivia Bolton"

# -------------------------------------------------------------
# SALES REPS
# Keys must match the email address on their Gong account exactly.
# -------------------------------------------------------------
SALES_REPS = {
    "emma.keeney@sitezeus.com": "Emma Keeney",
    "lucas.boney@sitezeus.com": "Lucas Boney",
    "mitchg@sitezeus.com": "Mitchell Gunderson",
    "william.morgan@sitezeus.com": "William Morgan",
}

# -------------------------------------------------------------
# ENTERPRISE CLASSIFICATION
# HubSpot property name + threshold. >= threshold = Enterprise.
# -------------------------------------------------------------
ENTERPRISE_UNIT_COUNT_PROPERTY = "unit_count"   # HubSpot property internal name
ENTERPRISE_THRESHOLD = 50                        # >= 50 units → Enterprise

# -------------------------------------------------------------
# EMAIL ADDRESSES
# -------------------------------------------------------------
SUPPORT_FROM_EMAIL = "support@sitezeus.com"
INTERNAL_NOTIFICATION_EMAIL = "support@sitezeus.com"  # Receives "contact not found" alerts

SITEZEUS_DOMAIN = "sitezeus.com"

# -------------------------------------------------------------
# SITEZEUS RESOURCE LINKS
# Update URLs to match the live sitezeus.com pages.
# topics[] = keywords matched against Gong tracker names (lowercase).
# The first 3-4 topic matches are selected; remaining slots
# are filled from the top of the list.
# -------------------------------------------------------------
ENTERPRISE_RESOURCES = [
    {
        "name": "White Space Analysis",
        "url": "https://sitezeus.com/products/site-selection-software",
        "topics": ["white space", "whitespace", "gap analysis", "untapped", "growth opportunity"],
    },
    {
        "name": "Sales Forecasting",
        "url": "https://sitezeus.com/products/site-selection-software",
        "topics": ["forecast", "sales forecast", "revenue forecast", "projection", "predict"],
    },
    {
        "name": "Sales Impact",
        "url": "https://sitezeus.com/products/site-selection-software",
        "topics": ["sales impact", "cannibalization", "roi", "revenue impact", "performance"],
    },
    {
        "name": "Customer Insights",
        "url": "https://sitezeus.com/products/customer-insights-platform",
        "topics": ["market", "customer insights", "trade area", "mobile data", "competition", "competitor"],
    },
    {
        "name": "Zeus AI",
        "url": "https://sitezeus.com/products/site-selection-software",
        "topics": ["zeus ai", "zeus", "ai", "artificial intelligence", "predictive", "machine learning"],
    },
    {
        "name": "SiteZeus Build",
        "url": "https://sitezeus.com/products/construction-management-software",
        "topics": ["build", "construction", "unit opening", "new location", "expansion", "open", "growth"],
    },
    {
        "name": "SiteZeus Sell",
        "url": "https://sitezeus.com/products/franchise-crm",
        "topics": ["sell", "franchise crm", "pipeline", "franchise sales", "disposition", "portfolio"],
    },
    {
        "name": "Proof of Concept",
        "url": "https://sitezeus.com/schedule-a-demo",
        "topics": ["poc", "proof of concept", "pilot", "test", "trial"],
    },
]

SMB_EMERGING_RESOURCES = [
    {
        "name": "SiteZeus Locate",
        "url": "https://sitezeus.com/products/site-selection-software",
        "topics": ["emerging", "site selection", "small business", "franchise", "growing", "startup", "locate"],
    },
    {
        "name": "SiteZeus Build",
        "url": "https://sitezeus.com/products/construction-management-software",
        "topics": ["build", "construction", "unit opening", "new location", "expansion", "open", "growth"],
    },
    {
        "name": "SiteZeus Sell",
        "url": "https://sitezeus.com/products/franchise-crm",
        "topics": ["sell", "franchise crm", "pipeline", "franchise sales", "disposition", "portfolio"],
    },
    {
        "name": "Customer Insights",
        "url": "https://sitezeus.com/products/customer-insights-platform",
        "topics": ["market", "customer insights", "trade area", "mobile data", "competition", "competitor"],
    },
]

CUSTOMER_STORIES_URL = "https://sitezeus.com/customer-stories"
