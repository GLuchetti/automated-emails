"""
gong_client.py — Gong REST API wrapper.
Handles auth, pagination, call retrieval, AI data, transcripts, and user/team lookup.
"""
import base64
import logging
from datetime import datetime
from typing import Optional

import requests

logger = logging.getLogger(__name__)


class GongClient:
    BASE_URL = "https://api.gong.io"

    def __init__(self, access_key: str, secret: str):
        credentials = base64.b64encode(f"{access_key}:{secret}".encode()).decode()
        self.headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/json",
        }
        self._users_cache: Optional[list] = None
        self._team_map_cache: Optional[dict] = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get(self, path: str, params: dict = None) -> dict:
        resp = requests.get(
            f"{self.BASE_URL}{path}",
            headers=self.headers,
            params=params,
            timeout=30,
        )
        if not resp.ok:
            logger.error("Gong API GET %s → %s: %s", path, resp.status_code, resp.text[:500])
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, body: dict) -> dict:
        resp = requests.post(
            f"{self.BASE_URL}{path}",
            headers=self.headers,
            json=body,
            timeout=30,
        )
        if not resp.ok:
            logger.error("Gong API POST %s → %s: %s", path, resp.status_code, resp.text[:500])
        resp.raise_for_status()
        return resp.json()

    def _paginate_get(self, path: str, list_key: str, params: dict = None) -> list:
        """Fetch all pages from a GET endpoint that supports cursor pagination."""
        params = params or {}
        items = []
        while True:
            data = self._get(path, params=params)
            items.extend(data.get(list_key, []))
            cursor = data.get("records", {}).get("cursor")
            if not cursor:
                break
            params = {**params, "cursor": cursor}
        return items

    # ------------------------------------------------------------------
    # Calls
    # ------------------------------------------------------------------

    def get_completed_calls(self, from_dt: datetime, to_dt: datetime) -> list:
        """
        Return all calls whose start time falls within [from_dt, to_dt].
        Both datetimes should be timezone-aware UTC.
        """
        params = {
            "fromDateTime": from_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "toDateTime": to_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        return self._paginate_get("/v2/calls", "calls", params=params)

    def get_calls_extensive(self, call_ids: list) -> list:
        """
        Fetch AI-enriched data for a batch of call IDs.
        Returns highlights, key points, action items, trackers, and parties.
        """
        if not call_ids:
            return []
        body = {
            "filter": {"callIds": call_ids},
            "contentSelector": {
                "exposedFields": {
                    "content": {
                        "trackers": True,
                        "highlights": True,
                        "keyPoints": True,
                        "actions": True,
                    },
                    "parties": True,
                }
            },
        }
        data = self._post("/v2/calls/extensive", body)
        return data.get("calls", [])

    def get_transcripts(self, call_ids: list) -> dict:
        """
        Fetch full transcripts for a list of call IDs.
        Returns: { call_id: [ {speakerId, text, start_ms}, ... ] }
        """
        if not call_ids:
            return {}
        body = {"filter": {"callIds": call_ids}}
        data = self._post("/v2/calls/transcript", body)
        result = {}
        for item in data.get("callTranscripts", []):
            call_id = item.get("callId")
            sentences = []
            for segment in item.get("transcript", []):
                speaker_id = segment.get("speakerId", "")
                for s in segment.get("sentences", []):
                    sentences.append(
                        {
                            "speakerId": speaker_id,
                            "text": s.get("text", "").strip(),
                            "start": s.get("start", 0),
                        }
                    )
            result[call_id] = sentences
        return result

    # ------------------------------------------------------------------
    # Users & team mapping
    # ------------------------------------------------------------------

    def get_users(self) -> list:
        """Return all Gong workspace users (cached for the lifetime of this client)."""
        if self._users_cache is None:
            self._users_cache = self._paginate_get("/v2/users", "users")
        return self._users_cache

    def build_team_map(self, sales_manager_name: str, support_manager_name: str) -> dict:
        """
        Returns { gong_user_id: "sales" | "support" } for every direct report
        of the given managers. Users not under either manager are absent from the dict.
        """
        if self._team_map_cache is not None:
            return self._team_map_cache

        users = self.get_users()

        # Locate manager IDs by full name
        sales_mgr_id = None
        support_mgr_id = None
        for u in users:
            full_name = f"{u.get('firstName', '')} {u.get('lastName', '')}".strip()
            if full_name == sales_manager_name:
                sales_mgr_id = u.get("id")
            if full_name == support_manager_name:
                support_mgr_id = u.get("id")

        if not sales_mgr_id:
            logger.warning("Sales manager '%s' not found in Gong users", sales_manager_name)
        if not support_mgr_id:
            logger.warning("Support manager '%s' not found in Gong users", support_manager_name)

        team_map = {}
        for u in users:
            mgr = u.get("managerId")
            if mgr and mgr == sales_mgr_id:
                team_map[u["id"]] = "sales"
            elif mgr and mgr == support_mgr_id:
                team_map[u["id"]] = "support"

        self._team_map_cache = team_map
        logger.info(
            "Team map built: %d sales reps, %d support reps",
            sum(1 for v in team_map.values() if v == "sales"),
            sum(1 for v in team_map.values() if v == "support"),
        )
        return team_map

    def user_email_map(self) -> dict:
        """Returns { gong_user_id: email_address } for all users."""
        return {u["id"]: u.get("emailAddress", "") for u in self.get_users()}
