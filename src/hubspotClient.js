// hubspotClient.js — HubSpot CRM API wrapper
// Handles contact lookup by email and enterprise classification.

const BASE_URL = "https://api.hubapi.com";

export class HubSpotClient {
  constructor(token) {
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async findContactByEmail(email) {
    const url = `${BASE_URL}/crm/v3/objects/contacts/search`;
    const body = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email.toLowerCase().trim(),
            },
          ],
        },
      ],
      properties: [
        "firstname",
        "lastname",
        "email",
        "hubspot_owner_id",
        "unit_count",
        "number_of_locations",
        "company",
      ],
      limit: 1,
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error(`[HubSpot] Contact search failed for ${email}: ${res.status}`);
        return null;
      }
      const data = await res.json();
      return data.results?.[0] || null;
    } catch (e) {
      console.error(`[HubSpot] Contact search error for ${email}:`, e.message);
      return null;
    }
  }

  async getOwnerEmail(ownerId) {
    if (!ownerId) return null;
    try {
      const res = await fetch(`${BASE_URL}/crm/v3/owners/${ownerId}`, {
        headers: this.headers,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.email || null;
    } catch {
      return null;
    }
  }

  isEnterprise(contact, unitCountProperty = "unit_count", threshold = 50) {
    const props = contact.properties || {};
    const raw = props[unitCountProperty] ?? props.number_of_locations;
    if (raw == null) return false;
    const val = parseFloat(raw);
    return !isNaN(val) && val >= threshold;
  }
}
