"""
main.py — Gong → Email Automation entry point.

Runs on a 15-minute GitHub Actions schedule.
1. Loads the last-run timestamp from state/last_run.json.
2. Queries Gong for calls completed since that timestamp.
3. Routes each call to the Support or Sales workflow based on Gong team.
4. Sends emails via Outlook SMTP.
5. Logs activity and regenerates the HTML dashboard.
6. Updates the last-run timestamp.
"""
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

from email_handler import send_email
from gong_client import GongClient
from hubspot_client import HubSpotClient
from sales_formatter import format_sales_review_email, build_prospect_html
from support_formatter import format_support_email
import config
import dashboard

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger(__name__)

STATE_FILE = Path(__file__).parent.parent / "state" / "last_run.json"


# ------------------------------------------------------------------
# State helpers
# ------------------------------------------------------------------

def load_last_run() -> datetime:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            return datetime.fromisoformat(data["last_run"])
        except Exception as e:
            logger.warning("Could not read state file: %s — defaulting to 25 min ago", e)
    return datetime.now(timezone.utc) - timedelta(minutes=25)


def save_last_run(dt: datetime) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"last_run": dt.isoformat()}))


# ------------------------------------------------------------------
# Participant helpers
# ------------------------------------------------------------------

def _external(parties: list) -> list:
    return [
        p for p in parties
        if p.get("emailAddress")
        and config.SITEZEUS_DOMAIN not in p.get("emailAddress", "").lower()
        and (p.get("affiliation") or "").lower() != "internal"
    ]


def _internal(parties: list) -> list:
    return [
        p for p in parties
        if p.get("emailAddress")
        and (
            config.SITEZEUS_DOMAIN in p.get("emailAddress", "").lower()
            or (p.get("affiliation") or "").lower() == "internal"
        )
    ]


# ------------------------------------------------------------------
# No-contact alert
# ------------------------------------------------------------------

def send_no_contact_alert(
    missing_email: str,
    call_name: str,
    call_id: str,
    notify_email: str,
    smtp_user: str,
    smtp_password: str,
) -> None:
    html = f"""
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
      <p><strong>⚠️ HubSpot Contact Not Found</strong></p>
      <p>A Gong call was processed but the external participant was not found in HubSpot.
      A follow-up email could not be sent automatically.</p>
      <table style="border-collapse:collapse;">
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Missing email</td>
            <td><strong>{missing_email}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Call</td>
            <td>{call_name}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">Gong Call ID</td>
            <td>{call_id}</td></tr>
      </table>
      <p>Please add this contact to HubSpot and send the follow-up manually.</p>
    </div>
    """
    try:
        send_email(
            smtp_user=smtp_user,
            smtp_password=smtp_password,
            from_address=config.SUPPORT_FROM_EMAIL,
            to_addresses=[notify_email],
            cc_addresses=[],
            subject=f"⚠️ Action Required: HubSpot contact missing — {missing_email}",
            body_html=html,
        )
    except Exception as e:
        logger.error("Failed to send no-contact alert: %s", e)


# ------------------------------------------------------------------
# Support workflow
# ------------------------------------------------------------------

def process_support_call(
    call_data: dict,
    gong: GongClient,
    hubspot: HubSpotClient,
    smtp_user: str,
    smtp_password: str,
    run_log: dict,
) -> None:
    meta = call_data.get("metaData", call_data)
    call_id = meta.get("id", "unknown")
    call_name = (meta.get("title") or "Your Recent Call").strip()
    parties = call_data.get("parties", [])

    external = _external(parties)
    internal_parties = _internal(parties)

    if not external:
        logger.warning("Call %s: no external participants — skipping", call_id)
        return

    primary_external = external[0]
    primary_email = primary_external.get("emailAddress", "")

    contact = hubspot.find_contact_by_email(primary_email)
    if not contact:
        logger.warning("Call %s: %s not in HubSpot", call_id, primary_email)
        send_no_contact_alert(
            missing_email=primary_email,
            call_name=call_name,
            call_id=call_id,
            notify_email=config.INTERNAL_NOTIFICATION_EMAIL,
            smtp_user=smtp_user,
            smtp_password=smtp_password,
        )
        run_log["calls_processed"].append({
            "call_id": call_id,
            "call_name": call_name,
            "team": "support",
            "status": "no_contact",
            "error": f"HubSpot contact not found: {primary_email}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return

    props = contact.get("properties", {})
    prospect_first_name = (
        props.get("firstname")
        or (primary_external.get("name") or "").split()[0]
        or "there"
    )
    prospect_last_name = props.get("lastname", "")
    prospect_full_name = f"{prospect_first_name} {prospect_last_name}".strip()

    subject, html = format_support_email(
        call_data=call_data,
        prospect_first_name=prospect_first_name,
        call_name=call_name,
    )

    to_emails = [p["emailAddress"] for p in external]
    cc_emails = [p["emailAddress"] for p in internal_parties]

    send_email(
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        from_address=config.SUPPORT_FROM_EMAIL,
        to_addresses=to_emails,
        cc_addresses=cc_emails,
        subject=subject,
        body_html=html,
    )

    run_log["calls_processed"].append({
        "call_id": call_id,
        "call_name": call_name,
        "team": "support",
        "prospect_name": prospect_full_name,
        "prospect_email": primary_email,
        "email_to": to_emails,
        "email_cc": cc_emails,
        "email_subject": subject,
        "email_html": html,
        "status": "sent",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    logger.info("Support email sent for call %s → %s", call_id, to_emails)


# ------------------------------------------------------------------
# Sales workflow
# ------------------------------------------------------------------

def process_sales_call(
    call_data: dict,
    rep_email: str,
    gong: GongClient,
    hubspot: HubSpotClient,
    smtp_user: str,
    smtp_password: str,
    run_log: dict,
) -> None:
    meta = call_data.get("metaData", call_data)
    call_id = meta.get("id", "unknown")
    call_name = (meta.get("title") or "Your Recent Call").strip()
    parties = call_data.get("parties", [])

    external = _external(parties)

    if not external:
        logger.warning("Call %s: no external participants — skipping", call_id)
        return

    primary_external = external[0]
    primary_email = primary_external.get("emailAddress", "")

    contact = hubspot.find_contact_by_email(primary_email)
    if not contact:
        logger.warning("Call %s: %s not in HubSpot", call_id, primary_email)
        send_no_contact_alert(
            missing_email=primary_email,
            call_name=call_name,
            call_id=call_id,
            notify_email=rep_email,
            smtp_user=smtp_user,
            smtp_password=smtp_password,
        )
        run_log["calls_processed"].append({
            "call_id": call_id,
            "call_name": call_name,
            "team": "sales",
            "rep_email": rep_email,
            "rep_name": config.SALES_REPS.get(rep_email, rep_email),
            "status": "no_contact",
            "error": f"HubSpot contact not found: {primary_email}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        return

    props = contact.get("properties", {})
    prospect_first_name = (
        props.get("firstname")
        or (primary_external.get("name") or "").split()[0]
        or "there"
    )
    prospect_last_name = props.get("lastname", "")
    prospect_full_name = f"{prospect_first_name} {prospect_last_name}".strip()

    is_enterprise = hubspot.is_enterprise(
        contact,
        unit_count_property=config.ENTERPRISE_UNIT_COUNT_PROPERTY,
        threshold=config.ENTERPRISE_THRESHOLD,
    )

    rep_name = config.SALES_REPS.get(rep_email, rep_email)

    subject, wrapper_html, prospect_preview_html = format_sales_review_email(
        call_data=call_data,
        rep_name=rep_name,
        rep_email=rep_email,
        prospect_first_name=prospect_first_name,
        prospect_email=primary_email,
        is_enterprise=is_enterprise,
        call_name=call_name,
    )

    send_email(
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        from_address=config.SUPPORT_FROM_EMAIL,
        to_addresses=[rep_email],
        cc_addresses=[],
        subject=subject,
        body_html=wrapper_html,
    )

    run_log["calls_processed"].append({
        "call_id": call_id,
        "call_name": call_name,
        "team": "sales",
        "rep_name": rep_name,
        "rep_email": rep_email,
        "prospect_name": prospect_full_name,
        "prospect_email": primary_email,
        "segment": "Enterprise" if is_enterprise else "SMB / Emerging",
        "email_to": [rep_email],
        "email_cc": [],
        "email_subject": subject,
        "email_html": prospect_preview_html,  # Show the prospect-facing draft
        "status": "sent",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    logger.info(
        "Sales review email sent for call %s → rep %s (%s)",
        call_id, rep_email, "Enterprise" if is_enterprise else "SMB/Emerging",
    )


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main() -> None:
    gong_key = os.environ["GONG_ACCESS_KEY"]
    gong_secret = os.environ["GONG_SECRET"]
    hubspot_token = os.environ["HUBSPOT_TOKEN"]
    smtp_user = os.environ["SUPPORT_EMAIL"]
    smtp_password = os.environ["SUPPORT_APP_PASSWORD"]

    gong = GongClient(gong_key, gong_secret)
    hubspot = HubSpotClient(hubspot_token)

    from_dt = load_last_run()
    to_dt = datetime.now(timezone.utc)

    logger.info("Checking calls from %s → %s", from_dt.isoformat(), to_dt.isoformat())

    # Initialise run log
    run_log = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": to_dt.isoformat(),
        "window_start": from_dt.isoformat(),
        "window_end": to_dt.isoformat(),
        "calls_found": 0,
        "calls_processed": [],
        "skipped": 0,
    }

    calls = gong.get_completed_calls(from_dt, to_dt)
    run_log["calls_found"] = len(calls)

    if not calls:
        logger.info("No new calls in window.")
        dashboard.record_run(run_log)
        save_last_run(to_dt)
        return

    logger.info("Found %d call(s)", len(calls))

    team_map = gong.build_team_map(
        sales_manager_name=config.SALES_MANAGER_NAME,
        support_manager_name=config.SUPPORT_MANAGER_NAME,
    )
    user_emails = gong.user_email_map()

    call_ids = [c.get("id") for c in calls if c.get("id")]
    extensive_list = gong.get_calls_extensive(call_ids)
    extensive_map = {}
    for ec in extensive_list:
        cid = (ec.get("metaData") or ec).get("id")
        if cid:
            extensive_map[cid] = ec

    for call in calls:
        call_id = call.get("id")
        if not call_id:
            continue

        call_data = extensive_map.get(call_id, call)
        host_id = (
            (call_data.get("metaData") or call_data).get("primaryUserId")
            or call.get("primaryUserId")
        )
        team = team_map.get(host_id)

        if not team:
            logger.info("Call %s: host not in a tracked team — skipping", call_id)
            run_log["skipped"] += 1
            continue

        logger.info("Call %s: routing to %s workflow", call_id, team)

        try:
            if team == "support":
                process_support_call(
                    call_data, gong, hubspot, smtp_user, smtp_password, run_log
                )
            elif team == "sales":
                rep_email = user_emails.get(host_id, "")
                if not rep_email:
                    logger.warning("Call %s: could not resolve rep email", call_id)
                    run_log["skipped"] += 1
                    continue
                process_sales_call(
                    call_data, rep_email, gong, hubspot, smtp_user, smtp_password, run_log
                )
        except Exception:
            logger.exception("Call %s: unhandled error — continuing", call_id)
            run_log["calls_processed"].append({
                "call_id": call_id,
                "call_name": (call_data.get("metaData") or call_data).get("title", "Unknown"),
                "team": team,
                "status": "error",
                "error": "Unexpected error — check GitHub Actions logs",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

    dashboard.record_run(run_log)
    save_last_run(to_dt)
    logger.info("Run complete.")


if __name__ == "__main__":
    main()
