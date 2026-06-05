"""
hubspot_client.py — HubSpot CRM API wrapper.
Handles contact lookup by email and enterprise classification.
"""
import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)


class HubSpotClient:
    BASE_URL = "https://api.hubapi.com"

    def __init__(self, token: str):
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # Contact lookup
    # ------------------------------------------------------------------

    def find_contact_by_email(self, email: str) -> Optional[dict]:
        """
        Search for a contact by email address.
        Returns the first matching contact dict (with 'properties' key), or None.
        """
        url = f"{self.BASE_URL}/crm/v3/objects/contacts/search"
        body = {
            "filterGroups": [
                {
                    "filters": [
                        {
                            "propertyName": "email",
                            "operator": "EQ",
                            "value": email.lower().strip(),
                        }
                    ]
                }
            ],
            "properties": [
                "firstname",
                "lastname",
                "email",
                "hubspot_owner_id",
                "unit_count",
                "number_of_locations",
                "company",
            ],
            "limit": 1,
        }
        try:
            resp = requests.post(url, headers=self.headers, json=body, timeout=30)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            return results[0] if results else None
        except requests.HTTPError as e:
            logger.error("HubSpot contact search failed for %s: %s", email, e)
            return None

    def get_owner_email(self, owner_id: str) -> Optional[str]:
        """Return the email address of a HubSpot owner by ID."""
        if not owner_id:
            return None
        url = f"{self.BASE_URL}/crm/v3/owners/{owner_id}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=30)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json().get("email")
        except requests.HTTPError as e:
            logger.error("HubSpot owner lookup failed for %s: %s", owner_id, e)
            return None

    # ------------------------------------------------------------------
    # Enterprise classification
    # ------------------------------------------------------------------

    def is_enterprise(
        self,
        contact: dict,
        unit_count_property: str = "unit_count",
        threshold: int = 50,
    ) -> bool:
        """
        Returns True if the contact's unit count meets the Enterprise threshold.
        Falls back to 'number_of_locations' if the primary property is absent.
        Defaults to False (SMB/Emerging) when data is missing.
        """
        props = contact.get("properties", {})
        raw = props.get(unit_count_property) or props.get("number_of_locations")
        if raw is None:
            logger.debug("No unit count property found for contact — defaulting to SMB")
            return False
        try:
            return int(float(raw)) >= threshold
        except (ValueError, TypeError):
            logger.warning("Could not parse unit count value '%s' — defaulting to SMB", raw)
            return False
