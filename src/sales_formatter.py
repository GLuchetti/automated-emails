"""
sales_formatter.py — Formats the Sales follow-up email for rep review.

The script sends an email TO the rep (not the prospect) containing a
pre-formatted draft the rep can review, edit, and send from their own account.

Prospect-facing template:
  Subject: SiteZeus Resources & Next Steps
  Hi {First Name},
  Thank you for taking the time to connect with me today...
  What we discussed: ... (from Gong brief or key points)
  Next steps: ... (from Gong actions or transcript)
  Resources: ...
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
    transcript: list = None,
) -> Tuple[str, str, str]:
    """
    Build the sales review email sent to the rep.
    Returns (subject, wrapper_html, prospect_preview_html).
    """
    content = call_data.get("content", {}) or {}
    highlights = content.get("highlights", []) or []
    trackers = content.get("trackers", []) or []

    # ----------------------------------------------------------------
    # 1. "What we discussed" — prefer Gong AI brief > key points > highlights > transcript
    # ----------------------------------------------------------------
    brief_text = _clean_text(content.get("brief"))
    key_points = _extract_key_points(content.get("keyPoints") or content.get("key_points"))
    call_highlights = _extract_highlights(highlights)[:5]

    # If Gong AI returned no highlights, extract key sentences from transcript
    if not call_highlights and transcript:
        call_highlights = _extract_from_transcript(transcript, rep_name)[:5]

    logger.info(
        "Gong AI fields — brief: %s, keyPoints: %d, highlights: %d",
        "yes" if brief_text else "no",
        len(key_points),
        len(call_highlights),
    )

    # ----------------------------------------------------------------
    # 2. Resources — from trackers, then outline/topics, then transcript
    # ----------------------------------------------------------------
    tracker_names = [
        t.get("name", "").lower()
        for t in trackers
        if (t.get("count") or 0) > 0
    ]
    # Try outline/topics fields for topic signals
    outline_topics = _extract_outline_topics(content.get("outline") or content.get("topics"))
    tracker_names = list(set(tracker_names + outline_topics))

    # Also scan transcript for product mentions if still empty
    if not tracker_names and transcript:
        tracker_names = _detect_topics_from_transcript(transcript)

    resources = _select_resources(tracker_names, is_enterprise)

    # ----------------------------------------------------------------
    # 3. Next steps — prefer Gong actions > action_item highlights > transcript
    # ----------------------------------------------------------------
    next_steps = _extract_gong_actions(content.get("actions"))
    if not next_steps:
        next_steps = [
            (h.get("text") or "").strip()
            for h in highlights
            if h.get("type", "").lower() in ("action_item", "action item", "next_step", "next step")
            and (h.get("text") or "").strip()
        ]
    if not next_steps and transcript:
        next_steps = _extract_action_items_from_transcript(transcript)[:5]

    # Detect next agreed meeting
    next_meeting = _detect_next_meeting(highlights)
    if not next_meeting and transcript:
        next_meeting = _detect_next_meeting_from_transcript(transcript)

    prospect_html = _build_prospect_html(
        prospect_first_name=prospect_first_name,
        rep_name=rep_name,
        brief_text=brief_text,
        key_points=key_points,
        highlights=call_highlights,
        resources=resources,
        next_meeting=next_meeting,
        next_steps=next_steps,
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

def _clean_text(val) -> Optional[str]:
    """Return stripped non-empty string or None."""
    if not val:
        return None
    if isinstance(val, str):
        t = val.strip()
        return t if t else None
    return None


def _extract_key_points(key_points_field) -> List[str]:
    """Extract bullet points from Gong keyPoints field (list of dicts or strings)."""
    if not key_points_field:
        return []
    items = []
    if isinstance(key_points_field, list):
        for kp in key_points_field:
            if isinstance(kp, str):
                t = kp.strip()
                if t:
                    items.append(t)
            elif isinstance(kp, dict):
                t = _clean_text(kp.get("text") or kp.get("title") or kp.get("description"))
                if t:
                    items.append(t)
    return items[:6]


def _extract_gong_actions(actions_field) -> List[str]:
    """Extract next steps from Gong actions field."""
    if not actions_field:
        return []
    items = []
    if isinstance(actions_field, list):
        for a in actions_field:
            if isinstance(a, str):
                t = a.strip()
                if t:
                    items.append(t)
            elif isinstance(a, dict):
                t = _clean_text(a.get("text") or a.get("description") or a.get("title"))
                if t:
                    items.append(t)
    return items[:5]


def _extract_outline_topics(outline_field) -> List[str]:
    """Extract topic names from Gong outline or topics field for resource matching."""
    if not outline_field:
        return []
    topics = []
    if isinstance(outline_field, list):
        for item in outline_field:
            if isinstance(item, str):
                topics.append(item.lower())
            elif isinstance(item, dict):
                name = item.get("name") or item.get("title") or item.get("topic") or ""
                if name:
                    topics.append(name.lower())
    elif isinstance(outline_field, str):
        topics.append(outline_field.lower())
    return topics


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
    next_steps: List[str] = None,
    brief_text: Optional[str] = None,
    key_points: List[str] = None,
) -> str:
    parts = []
    parts.append(f"<p>Hi {prospect_first_name},</p>")
    parts.append(
        "<p>Thank you for taking the time to connect with me today. "
        "I wanted to follow up with a quick recap of what we covered.</p>"
    )

    # ---- What we discussed ----
    # Priority: Gong AI brief (paragraph) > key points (bullets) > highlights (bullets)
    if brief_text:
        parts.append("<p><strong>What we discussed:</strong></p>")
        # Render brief as a paragraph — it's already a clean AI summary
        parts.append(f"<p>{brief_text}</p>")
    elif key_points:
        parts.append("<p><strong>What we discussed:</strong></p>")
        parts.append(_bullet_list(key_points))
    elif highlights:
        parts.append("<p><strong>What we discussed:</strong></p>")
        parts.append(_bullet_list(highlights))

    # ---- Next steps ----
    if next_steps:
        parts.append("<p><strong>Next steps:</strong></p>")
        parts.append(_bullet_list(next_steps))
    elif next_meeting:
        parts.append("<p><strong>Next steps:</strong></p>")
        parts.append(f"<p>{next_meeting}</p>")
    else:
        parts.append("<p><strong>Next steps:</strong></p>")
        parts.append(
            "<p>I'll be in touch soon. Feel free to reach out with any questions in the meantime. "
            "You can find time through the scheduling link in my signature.</p>"
        )

    # ---- Resources ----
    if resources:
        parts.append("<p><strong>Resources:</strong></p>")
        resource_items = [
            f'<a href="{r["url"]}" style="color:#1a73e8;">{r["name"]}</a>'
            for r in resources
        ]
        parts.append(_bullet_list(resource_items))

    parts.append(f"<p>Best,<br>{rep_name}</p>")
    return "\n".join(parts)


PRODUCT_KEYWORDS = {
    "locate": ["locate", "site selection", "forecast", "revenue", "model", "prediction"],
    "build": ["build", "construction", "milestone", "opening", "timeline", "project"],
    "sell": ["sell", "franchise", "crm", "pipeline", "candidate", "territory"],
    "market": ["market", "customer insights", "trade area", "mobile data", "consumer"],
    "zeus_ai": ["zeus", "ai", "artificial intelligence", "predict", "recommendation"],
    "white_space": ["white space", "whitespace", "expansion", "growth", "new market"],
    "sales_impact": ["cannibalization", "impact", "transfer", "overlap"],
    "poc": ["proof of concept", "poc", "pilot", "trial", "test"],
    "pricing": ["pricing", "price", "cost", "investment", "contract", "proposal"],
}

NEXT_MEETING_KEYWORDS = ["next week", "follow up", "follow-up", "schedule", "tuesday",
                          "wednesday", "thursday", "monday", "friday", "next call",
                          "next meeting", "demo", "presentation"]


def _extract_from_transcript(transcript: list, rep_name: str) -> List[str]:
    """Extract meaningful sentences from transcript as highlights."""
    rep_first = rep_name.split()[0].lower() if rep_name else ""
    highlights = []
    seen = set()

    for s in transcript:
        text = (s.get("text") or "").strip()
        if len(text) < 20 or len(text) > 200:
            continue
        tl = text.lower()
        # Skip small talk and generic openers
        if any(skip in tl for skip in ["how are you", "happy friday", "nice to meet",
                                        "how's it going", "sounds good", "absolutely",
                                        "yeah", "okay", "alright", "perfect"]):
            continue
        # Prefer sentences that mention SiteZeus products or business value
        for group, keywords in PRODUCT_KEYWORDS.items():
            if any(kw in tl for kw in keywords) and text not in seen:
                highlights.append(text)
                seen.add(text)
                break
        if len(highlights) >= 5:
            break

    return highlights


def _detect_topics_from_transcript(transcript: list) -> List[str]:
    """Scan transcript for product/topic mentions to guide resource selection."""
    topics = set()
    full_text = " ".join((s.get("text") or "").lower() for s in transcript)
    for topic, keywords in PRODUCT_KEYWORDS.items():
        if any(kw in full_text for kw in keywords):
            topics.add(topic.replace("_", " "))
    return list(topics)


def _extract_action_items_from_transcript(transcript: list) -> List[str]:
    """Extract action items — sentences where someone commits to doing something."""
    action_phrases = [
        "i will", "i'll", "we will", "we'll", "i'm going to",
        "will send", "will follow", "will check", "will get back",
        "will discuss", "will review", "will share", "will reach out",
        "will connect", "by end of", "by next week", "by friday",
        "going to send", "going to follow"
    ]
    items = []
    seen = set()
    for s in transcript:
        text = (s.get("text") or "").strip()
        tl = text.lower()
        if 15 < len(text) < 200 and any(p in tl for p in action_phrases):
            if text not in seen:
                items.append(text)
                seen.add(text)
    return items


def _detect_next_meeting_from_transcript(transcript: list) -> Optional[str]:
    """Scan transcript for next meeting references."""
    for s in reversed(transcript):
        text = (s.get("text") or "").strip()
        tl = text.lower()
        if any(kw in tl for kw in NEXT_MEETING_KEYWORDS) and len(text) < 150:
            return text
    return None


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
