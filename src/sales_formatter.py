"""
sales_formatter.py — Formats the Sales follow-up email for rep review.

The script sends an email TO the rep (not the prospect) containing a
pre-formatted draft the rep can review, edit, and send from their own account.

Prospect-facing template:
  Subject: SiteZeus Resources & Next Steps
  Hi {First Name},
  Thank you for taking the time to connect with me today...
  Quick highlights on SiteZeus: ...
  Resources: ...
  Next steps: ...
  Best, {Rep Name}
"""
import logging
from typing import List, Optional, Tuple

import config

logger = logging.getLogger(__name__)

# Highlight types to EXCLUDE from the "Quick highlights" section
EXCLUDE_HIGHLIGHT_TYPES = {
    "action_item", "action item", "next_step", "next step",
    "decision", "key_decision",
}

NEXT_MEETING_TYPES = {"next_meeting", "follow_up", "follow-up", "upcoming_meeting"}


def build_prospect_html(
    call_data: dict,
    rep_name: str,
    prospect_first_name: str,
    is_enterprise: bool,
) -> str:
    """Build just the prospect-facing email body (used for dashboard preview)."""
    content = call_data.get("content", {})
    highlights = content.get("highlights", [])
    trackers = content.get("trackers", [])
    call_highlights = _extract_highlights(highlights)[:5]
    tracker_names = [t.get("name", "").lower() for t in trackers if (t.get("count") or 0) > 0]
    resources = _select_resources(tracker_names, is_enterprise)
    next_meeting = _detect_next_meeting(highlights)
    return _build_prospect_html(
        prospect_first_name=prospect_first_name,
        rep_name=rep_name,
        highlights=call_highlights,
        resources=resources,
        next_meeting=next_meeting,
    )


def format_sales_review_email(
    call_data: dict,
    rep_name: str,
    rep_email: str,
    prospect_first_name: str,
    prospect_email: str,
    is_enterprise: bool,
    call_name: str,
) -> Tuple[str, str, str]:
    """
    Build the sales review email sent to the rep.
    Returns (subject, wrapper_html, prospect_preview_html).
    """
    content = call_data.get("content", {})
    highlights = content.get("highlights", [])
    trackers = content.get("trackers", [])

    # Top 5 call highlights (excluding action items / decisions)
    call_highlights = _extract_highlights(highlights)[:5]

    # Select 3-4 relevant resources + 1 customer story
    tracker_names = [
        t.get("name", "").lower()
        for t in trackers
        if (t.get("count") or 0) > 0
    ]
    resources = _select_resources(tracker_names, is_enterprise)

    # Detect next agreed meeting from highlights
    next_meeting = _detect_next_meeting(highlights)

    prospect_html = _build_prospect_html(
        prospect_first_name=prospect_first_name,
        rep_name=rep_name,
        highlights=call_highlights,
        resources=resources,
        next_meeting=next_meeting,
    )

    segment_label = "Enterprise" if is_enterprise else "SMB / Emerging"
    wrapper_html = _build_rep_wrapper(
        rep_email=rep_email,
        prospect_first_name=prospect_first_name,
        prospect_email=prospect_email,
        segment_label=segment_label,
        call_name=call_name,
        prospect_html=prospect_html,
    )

    subject = f"[REVIEW & SEND] Follow-up draft for {prospect_first_name} — {call_name}"
    return subject, wrapper_html, prospect_html


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _extract_highlights(highlights: list) -> List[str]:
    texts = []
    for h in highlights:
        h_type = (h.get("type") or "").lower()
        text = (h.get("text") or "").strip()
        if text and h_type not in EXCLUDE_HIGHLIGHT_TYPES:
            texts.append(text)
    return texts


def _select_resources(tracker_names: List[str], is_enterprise: bool) -> List[dict]:
    """
    Pick resources whose topics overlap with what was discussed on the call.
    Fill remaining slots from the top of the resource list.
    Always appends a Customer Stories link at the end.
    Max 4 resources + Customer Stories.
    """
    pool = config.ENTERPRISE_RESOURCES if is_enterprise else config.SMB_EMERGING_RESOURCES
    selected = []
    selected_names = set()

    # Topic-matched resources first
    for resource in pool:
        if len(selected) >= 4:
            break
        for topic in resource.get("topics", []):
            if any(topic in tracker for tracker in tracker_names):
                if resource["name"] not in selected_names:
                    selected.append(resource)
                    selected_names.add(resource["name"])
                break

    # Fill remaining slots from pool top
    for resource in pool:
        if len(selected) >= 4:
            break
        if resource["name"] not in selected_names:
            selected.append(resource)
            selected_names.add(resource["name"])

    # Always include customer stories
    selected.append({"name": "Customer Stories", "url": config.CUSTOMER_STORIES_URL})
    return selected


def _detect_next_meeting(highlights: list) -> Optional[str]:
    for h in highlights:
        h_type = (h.get("type") or "").lower()
        text = (h.get("text") or "").strip()
        if h_type in NEXT_MEETING_TYPES and text:
            return text
    return None


def _bullet_list(items) -> str:
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def _build_prospect_html(
    prospect_first_name: str,
    rep_name: str,
    highlights: List[str],
    resources: List[dict],
    next_meeting: Optional[str],
) -> str:
    parts = []
    parts.append(f"<p>Hi {prospect_first_name},</p>")
    parts.append(
        "<p>Thank you for taking the time to connect with me today. "
        "I wanted to send over a few resources and recap the main areas we covered.</p>"
    )

    if highlights:
        parts.append("<p><strong>Quick highlights on SiteZeus:</strong></p>")
        parts.append(_bullet_list(highlights))

    if resources:
        parts.append("<p><strong>Resources:</strong></p>")
        resource_items = [
            f'<a href="{r["url"]}" style="color:#1a73e8;">{r["name"]}</a>'
            for r in resources
        ]
        parts.append(_bullet_list(resource_items))

    parts.append("<p><strong>Next steps:</strong></p>")
    if next_meeting:
        parts.append(f"<p>Looking forward to continuing the conversation on {next_meeting}.</p>")
    else:
        parts.append(
            "<p>I think the best next step would be to find time to continue our conversation. "
            "You can find time through the scheduling link in my signature.</p>"
        )

    parts.append(f"<p>Best,<br>{rep_name}</p>")
    return "\n".join(parts)


def _build_rep_wrapper(
    rep_email: str,
    prospect_first_name: str,
    prospect_email: str,
    segment_label: str,
    call_name: str,
    prospect_html: str,
) -> str:
    return f"""
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;max-width:680px;">

  <div style="background:#fff8e1;padding:14px 18px;border-left:5px solid #f9a825;margin-bottom:20px;border-radius:3px;">
    <strong>ACTION REQUIRED — Review &amp; Send</strong><br><br>
    This is a draft follow-up email for <strong>{prospect_first_name}</strong>
    (<a href="mailto:{prospect_email}">{prospect_email}</a>).<br>
    <strong>Segment:</strong> {segment_label} &nbsp;|&nbsp;
    <strong>Call:</strong> {call_name}<br><br>
    Review the draft below. Edit as needed, then send it to the prospect from
    your own email account (<strong>{rep_email}</strong>).<br>
    <em>Do not reply to this message — it was sent automatically.</em>
  </div>

  <hr style="border:none;border-top:1px solid #ddd;margin:0 0 20px 0;">

  <p style="color:#888;font-size:12px;margin-bottom:4px;">
    Suggested subject: <strong>SiteZeus Resources &amp; Next Steps</strong>
  </p>

  <div style="border:1px solid #e0e0e0;padding:20px;border-radius:4px;background:#fafafa;">
    {prospect_html}
  </div>

</div>
"""
