"""
email_handler.py — Sends emails via Outlook SMTP (smtp.office365.com).
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List

logger = logging.getLogger(__name__)

SMTP_SERVER = "smtp.office365.com"
SMTP_PORT = 587


def send_email(
    smtp_user: str,
    smtp_password: str,
    from_address: str,
    to_addresses: List[str],
    cc_addresses: List[str],
    subject: str,
    body_html: str,
    body_text: str = None,
) -> None:
    """
    Send an HTML email via Outlook SMTP.

    Args:
        smtp_user:      The account used to authenticate (e.g. support@sitezeus.com).
        smtp_password:  App password for that account.
        from_address:   Display "From" address (can differ from smtp_user if permitted).
        to_addresses:   Primary recipients.
        cc_addresses:   CC recipients (de-duped against to_addresses automatically).
        subject:        Email subject line.
        body_html:      HTML body.
        body_text:      Optional plain-text fallback. Auto-generated if omitted.
    """
    to_addresses = [a.strip() for a in to_addresses if a and a.strip()]
    cc_addresses = [
        a.strip()
        for a in cc_addresses
        if a and a.strip() and a.strip() not in to_addresses
    ]

    if not to_addresses:
        logger.warning("send_email called with no valid To addresses — skipping")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_address
    msg["To"] = ", ".join(to_addresses)
    if cc_addresses:
        msg["Cc"] = ", ".join(cc_addresses)

    plain = body_text or _strip_html(body_html)
    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    all_recipients = list(set(to_addresses + cc_addresses))

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(from_address, all_recipients, msg.as_string())
        logger.info("Email sent | subject='%s' | to=%s | cc=%s", subject, to_addresses, cc_addresses)
    except smtplib.SMTPAuthenticationError:
        logger.error(
            "SMTP authentication failed for %s — check SUPPORT_APP_PASSWORD secret", smtp_user
        )
        raise
    except Exception as e:
        logger.error("Failed to send email '%s': %s", subject, e)
        raise


def _strip_html(html: str) -> str:
    """Naive HTML → plain text for the fallback MIME part."""
    import re
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</li>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
