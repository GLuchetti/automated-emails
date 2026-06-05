"""
support_formatter.py — Formats the Support post-call summary email.

Template structure:
  Hi {First Name},
  Below is a summary of the action items discussed during {Call Name}.

  SiteZeus Team
    • {Action Item}, {Due Date or Milestone}

  {Client Participant Name}
    • {Action Item}, {Due Date or Milestone}

  Key Decisions
    • {Decision}

  Next Milestone
    • {Upcoming checkpoint or meeting}

  Best,
  SiteZeus Support Team
"""
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

SITEZEUS_DOMAIN = "sitezeus.com"

# Gong highlight types we treat as action items (fallback when .actions is empty)
ACTION_ITEM_TYPES = {"action_item", "action item", "next_step", "next step", "task"}

# Highlight types we treat as key decisions
DECISION_TYPES = {"decision", "key_decision", "agreement", "key_point", "conclusion"}

# Highlight types we treat as next milestone
MILESTONE_TYPES = {
    "next_meeting", "next_step", "milestone", "follow_up",
    "follow-up", "upcoming", "checkpoint",
}


def format_support_email(
    call_data: dict,
    prospect_first_name: str,
    call_name: str,
) -> Tuple[str, str]:
    """
    Build the support summary email.
    Returns (subject, html_body).
    """
    parties = call_data.get("parties", [])
    content = call_data.get("content", {})
    highlights = content.get("highlights", [])
    actions = content.get("actions", [])

    # Speaker ID → party info
    speaker_map = {p["speakerId"]: p for p in parties if p.get("speakerId")}

    # ----------------------------------------------------------------
    # Action items — prefer .actions; fall back to action-type highlights
    # ----------------------------------------------------------------
    if not actions:
        actions = [
            {"text": h.get("text", ""), "speakerId": h.get("speakerId", ""), "dueDate": ""}
            for h in highlights
            if h.get("type", "").lower() in ACTION_ITEM_TYPES and h.get("text", "").strip()
        ]

    sitezeus_actions: List[str] = []
    client_actions: dict = {}   # name → [formatted item, ...]

    for action in actions:
        text = (action.get("text") or "").strip()
        if not text:
            continue

        speaker_id = (
            action.get("speakerId")
            or action.get("assignee", {}).get("speakerId", "")
        )
        party = speaker_map.get(speaker_id, {})
        due = (action.get("dueDate") or "").strip()
        item = f"{text}, {due}" if due else text

        if _is_sitezeus(party):
            sitezeus_actions.append(item)
        else:
            name = (party.get("name") or "").strip() or "Client"
            client_actions.setdefault(name, []).append(item)

    # ----------------------------------------------------------------
    # Key Decisions
    # ----------------------------------------------------------------
    decisions: List[str] = []
    for h in highlights:
        if h.get("type", "").lower() in DECISION_TYPES:
            text = (h.get("text") or "").strip()
            if text and text not in decisions:
                decisions.append(text)

    for kp in content.get("keyPoints", []):
        text = (kp.get("text") or "").strip()
        if text and text not in decisions:
            decisions.append(text)

    # ----------------------------------------------------------------
    # Next Milestone
    # ----------------------------------------------------------------
    next_milestones: List[str] = []
    for h in highlights:
        if h.get("type", "").lower() in MILESTONE_TYPES:
            text = (h.get("text") or "").strip()
            if text and text not in next_milestones:
                next_milestones.append(text)

    html = _build_html(
        prospect_first_name=prospect_first_name,
        call_name=call_name,
        sitezeus_actions=sitezeus_actions,
        client_actions=client_actions,
        decisions=decisions,
        next_milestones=next_milestones,
    )

    subject = f"Action Items & Next Steps — {call_name}"
    return subject, html


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _is_sitezeus(party: dict) -> bool:
    email = (party.get("emailAddress") or "").lower()
    affiliation = (party.get("affiliation") or "").lower()
    return SITEZEUS_DOMAIN in email or affiliation == "internal"


def _bullet_list(items: List[str]) -> str:
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def _build_html(
    prospect_first_name: str,
    call_name: str,
    sitezeus_actions: List[str],
    client_actions: dict,
    decisions: List[str],
    next_milestones: List[str],
) -> str:
    S = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:680px;">'
    parts = [S]

    parts.append(f"<p>Hi {prospect_first_name},</p>")
    parts.append(
        f"<p>Below is a summary of the action items discussed during "
        f"<strong>{call_name}</strong>.</p>"
    )

    if sitezeus_actions:
        parts.append("<p><strong>SiteZeus Team</strong></p>")
        parts.append(_bullet_list(sitezeus_actions))

    for name, items in client_actions.items():
        if items:
            parts.append(f"<p><strong>{name}</strong></p>")
            parts.append(_bullet_list(items))

    if decisions:
        parts.append("<p><strong>Key Decisions</strong></p>")
        parts.append(_bullet_list(decisions))

    if next_milestones:
        parts.append("<p><strong>Next Milestone</strong></p>")
        parts.append(_bullet_list(next_milestones))

    parts.append("<p>Best,<br><strong>SiteZeus Support Team</strong></p>")
    parts.append("</div>")

    return "\n".join(parts)
