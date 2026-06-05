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
    "mitchell.gunderson@sitezeus.com": "Mitchell Gunderson",
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
        "url": "https://sitezeus.com/white-space-analysis",
        "topics": ["white space", "whitespace", "gap analysis", "untapped"],
    },
    {
        "name": "Sales Forecasting",
        "url": "https://sitezeus.com/sales-forecasting",
        "topics": ["forecast", "sales forecast", "revenue forecast", "projection"],
    },
    {
        "name": "Sales Impact",
        "url": "https://sitezeus.com/sales-impact",
        "topics": ["sales impact", "roi", "revenue impact", "performance"],
    },
    {
        "name": "SiteZeus Market",
        "url": "https://sitezeus.com/market",
        "topics": ["market", "competitive", "trade area", "competition", "competitor"],
    },
    {
        "name": "Zeus AI",
        "url": "https://sitezeus.com/zeus-ai",
        "topics": ["zeus ai", "zeus", "ai", "artificial intelligence", "predictive", "machine learning"],
    },
    {
        "name": "Build",
        "url": "https://sitezeus.com/build",
        "topics": ["build", "site selection", "new location", "expansion", "open", "growth"],
    },
    {
        "name": "Sell",
        "url": "https://sitezeus.com/sell",
        "topics": ["sell", "disposition", "portfolio optimization", "close", "underperform"],
    },
    {
        "name": "Proof of Concept",
        "url": "https://sitezeus.com/proof-of-concept",
        "topics": ["poc", "proof of concept", "pilot", "test", "trial"],
    },
]

SMB_EMERGING_RESOURCES = [
    {
        "name": "What is SiteZeus Emerging",
        "url": "https://sitezeus.com/emerging",
        "topics": ["emerging", "small business", "franchise", "growing", "startup"],
    },
    {
        "name": "Build",
        "url": "https://sitezeus.com/build",
        "topics": ["build", "site selection", "new location", "expansion", "open", "growth"],
    },
    {
        "name": "Sell",
        "url": "https://sitezeus.com/sell",
        "topics": ["sell", "disposition", "portfolio", "close", "underperform"],
    },
    {
        "name": "SiteZeus Market",
        "url": "https://sitezeus.com/market",
        "topics": ["market", "competitive", "trade area", "competition", "competitor"],
    },
]

CUSTOMER_STORIES_URL = "https://sitezeus.com/customer-stories"
