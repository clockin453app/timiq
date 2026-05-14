"""SMTP email delivery (optional). Never log message bodies containing secrets."""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import Settings

logger = logging.getLogger(__name__)


def smtp_delivery_configured(settings: Settings) -> bool:
    if not settings.timiq_email_enabled:
        return False
    if not settings.timiq_smtp_host.strip():
        return False
    if not settings.timiq_email_from.strip():
        return False
    return True


def send_plain_email(settings: Settings, *, to_address: str, subject: str, body: str) -> None:
    if not smtp_delivery_configured(settings):
        raise RuntimeError("Email is not configured.")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.timiq_email_from.strip()
    msg["To"] = to_address.strip()
    msg.set_content(body)

    host = settings.timiq_smtp_host.strip()
    port = int(settings.timiq_smtp_port)
    use_tls = bool(settings.timiq_smtp_use_tls)
    username = settings.timiq_smtp_username.strip()
    password = settings.timiq_smtp_password

    try:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            smtp.ehlo()
            if use_tls:
                context = ssl.create_default_context()
                smtp.starttls(context=context)
                smtp.ehlo()
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)
    except OSError as exc:
        logger.warning("SMTP send failed for recipient domain (details omitted).")
        raise RuntimeError("Could not send email.") from exc

    logger.info("Transactional email sent (recipient and subject omitted).")
