from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.email.frontend_urls import build_frontend_url
from app.core.email.smtp_sender import send_plain_email, smtp_delivery_configured
from app.modules.audit.service import create_internal_audit_event
from app.modules.auth import account_tokens_repository as token_repo
from app.modules.auth.forgot_password_rate_limit import allow_forgot_password_attempt
from app.modules.auth.models import AccountTokenPurpose, SystemRole, User
from app.modules.auth.repository import get_user_by_email, get_user_by_id, update_user
from app.modules.auth.security import hash_password, verify_password
from app.modules.auth.service import (
    DuplicateEmailError,
    resolve_company_for_create_or_update,
)
from app.modules.auth.token_utils import generate_raw_account_token, hash_account_token
from app.modules.auth.schemas import (
    AcceptInviteRequest,
    InviteUserRequest,
    InviteUserResponse,
    PasswordChangeRequest,
    ResetPasswordWithTokenRequest,
    UserResponse,
)
from app.modules.employee_profiles.models import EmployeeProfile
from app.modules.companies.repository import get_company_by_id
from app.modules.employee_profiles.repository import (
    get_employee_profile_by_user_id,
    save_employee_profile,
    update_employee_profile,
)

logger = logging.getLogger(__name__)

GENERIC_FORGOT_MESSAGE = "If an account exists for this email, a reset link has been sent."

PASSWORD_RESET_MINUTES = 45
INVITE_EXPIRY_DAYS = 7
EMAIL_VERIFY_HOURS = 48


def _is_local_env() -> bool:
    return settings.app_env.strip().lower() == "local"


def _peer_hashes(ip: str | None, ua: str | None) -> tuple[str | None, str | None]:
    ip_h = hashlib.sha256(f"ip|{ip or ''}".encode()).hexdigest() if ip else None
    ua_h = hashlib.sha256(f"ua|{(ua or '')[:600]}".encode()).hexdigest() if ua else None
    return ip_h, ua_h


def _password_reset_email_body(*, reset_url: str) -> tuple[str, str]:
    subject = "Reset your TimIQ password"
    body = (
        "You requested a password reset for your TimIQ account.\n\n"
        f"Use this link to choose a new password (valid about {PASSWORD_RESET_MINUTES} minutes):\n"
        f"{reset_url}\n\n"
        "If you did not request this, you can ignore this email.\n"
    )
    return subject, body


def _role_label(role: SystemRole) -> str:
    return role.value.replace("_", " ").title()


def _invite_email_body(
    *,
    invite_url: str,
    note: str | None,
    company_name: str | None = None,
    role: SystemRole | None = None,
) -> tuple[str, str]:
    subject = "You have been invited to TimIQ"
    context_lines: list[str] = []
    if company_name and company_name.strip():
        context_lines.append(f"Company: {company_name.strip()}")
    if role is not None:
        context_lines.append(f"Role: {_role_label(role)}")
    context = "\n".join(context_lines)
    context_block = f"{context}\n\n" if context else ""
    extra = f"\nMessage from your administrator:\n{note}\n" if (note and note.strip()) else ""
    body = (
        "You have been invited to join TimIQ.\n\n"
        f"{context_block}"
        f"Use this link to set your password and activate your account (valid about {INVITE_EXPIRY_DAYS} days):\n"
        f"{invite_url}\n"
        f"{extra}\n"
        "If you were not expecting this invitation, you can ignore this email.\n"
    )
    return subject, body


def _verify_email_body(*, verify_url: str) -> tuple[str, str]:
    subject = "Verify your email — TimIQ"
    body = (
        "Confirm that you control this email address for your TimIQ account.\n\n"
        f"Use this link (valid about {EMAIL_VERIFY_HOURS} hours):\n"
        f"{verify_url}\n\n"
        "If you did not request verification, you can ignore this email.\n"
    )
    return subject, body


def _invite_requires_smtp_or_local_dev_link() -> None:
    if smtp_delivery_configured(settings):
        return
    if _is_local_env():
        return
    raise ValueError("Email delivery must be configured before inviting users.")


def change_my_password(
    db_session: Session,
    actor: User,
    body: PasswordChangeRequest,
) -> None:
    if not verify_password(body.current_password, actor.password_hash):
        raise ValueError("Current password is incorrect.")

    if body.current_password == body.new_password:
        raise ValueError("New password must be different from your current password.")

    now = datetime.now(timezone.utc)
    actor.password_hash = hash_password(body.new_password)
    actor.password_changed_at = now
    update_user(db_session, actor)
    create_internal_audit_event(
        db_session,
        actor,
        action="auth.password_changed",
        entity_type="user",
        entity_id=str(actor.id),
        company_id=actor.company_id if actor.system_role != SystemRole.ADMINISTRATOR else None,
        details={"actor_user_id": str(actor.id), "user_id": str(actor.id)},
    )


def request_forgot_password(
    db_session: Session,
    *,
    email: str,
    client_key: str,
) -> str:
    if not allow_forgot_password_attempt(client_key):
        raise ValueError("rate_limited")

    user = get_user_by_email(db_session, email)
    if user is None or not user.is_active:
        return GENERIC_FORGOT_MESSAGE

    raw = generate_raw_account_token()
    th = hash_account_token(raw)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=PASSWORD_RESET_MINUTES)
    token_repo.invalidate_unused_tokens_for_user_purpose(db_session, user.id, AccountTokenPurpose.PASSWORD_RESET)
    token_repo.insert_account_token(
        db_session,
        user_id=user.id,
        email_normalized=user.email,
        token_hash=th,
        purpose=AccountTokenPurpose.PASSWORD_RESET,
        expires_at=expires,
        created_by_user_id=None,
        request_ip_hash=None,
        user_agent_hash=None,
        invite_meta=None,
    )
    db_session.flush()

    reset_url = build_frontend_url(settings, "/reset-password", {"token": raw})
    if smtp_delivery_configured(settings):
        try:
            subj, text = _password_reset_email_body(reset_url=reset_url)
            send_plain_email(settings, to_address=user.email, subject=subj, body=text)
        except RuntimeError:
            logger.exception("Forgot-password email send failed.")
            db_session.rollback()
            return GENERIC_FORGOT_MESSAGE
    else:
        if not _is_local_env():
            logger.warning("Forgot-password requested but SMTP is not configured (non-local).")
        db_session.rollback()
        return GENERIC_FORGOT_MESSAGE

    create_internal_audit_event(
        db_session,
        user,
        action="auth.password_reset_requested",
        entity_type="user",
        entity_id=str(user.id),
        company_id=user.company_id if user.system_role != SystemRole.ADMINISTRATOR else None,
        details={"user_id": str(user.id)},
    )
    return GENERIC_FORGOT_MESSAGE


def complete_password_reset_with_token(
    db_session: Session,
    body: ResetPasswordWithTokenRequest,
) -> None:
    th = hash_account_token(body.token.strip())
    row = token_repo.get_unused_token_by_hash(db_session, th, AccountTokenPurpose.PASSWORD_RESET)
    now = datetime.now(timezone.utc)
    if row is None or row.expires_at < now:
        raise ValueError("invalid_token")

    user = get_user_by_id(db_session, row.user_id)
    if user is None or not user.is_active:
        raise ValueError("invalid_token")

    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = now
    if user.email_verified_at is None:
        user.email_verified_at = now
    token_repo.mark_token_used(db_session, row)
    update_user(db_session, user)

    create_internal_audit_event(
        db_session,
        user,
        action="auth.password_reset_completed",
        entity_type="user",
        entity_id=str(user.id),
        company_id=user.company_id if user.system_role != SystemRole.ADMINISTRATOR else None,
        details={"user_id": str(user.id)},
    )


def invite_user_by_email(
    db_session: Session,
    actor: User,
    body: InviteUserRequest,
) -> InviteUserResponse:
    _invite_requires_smtp_or_local_dev_link()

    existing = get_user_by_email(db_session, body.email)
    if existing is not None:
        raise DuplicateEmailError("A user with this email already exists.")

    company_id = resolve_company_for_create_or_update(
        db_session=db_session,
        actor=actor,
        requested_company_id=body.company_id,
        requested_role=body.system_role,
    )

    unusable = hash_password(secrets.token_urlsafe(64))
    now = datetime.now(timezone.utc)
    user = User(
        email=body.email,
        password_hash=unusable,
        system_role=body.system_role,
        company_id=company_id,
        is_active=False,
        invited_at=now,
    )
    db_session.add(user)
    db_session.flush()

    meta = None
    if body.first_name or body.last_name or body.job_title or body.personal_message:
        meta = {
            "first_name": (body.first_name or "").strip() or None,
            "last_name": (body.last_name or "").strip() or None,
            "job_title": (body.job_title or "").strip() or None,
            "message": (body.personal_message or "").strip() or None,
        }

    if body.first_name or body.last_name or body.job_title:
        if company_id is not None:
            profile = EmployeeProfile(
                user_id=user.id,
                company_id=company_id,
                first_name=(body.first_name or "").strip() or None,
                last_name=(body.last_name or "").strip() or None,
                job_title=(body.job_title or "").strip() or None,
            )
            db_session.add(profile)

    raw = generate_raw_account_token()
    th = hash_account_token(raw)
    expires = now + timedelta(days=INVITE_EXPIRY_DAYS)
    token_repo.insert_account_token(
        db_session,
        user_id=user.id,
        email_normalized=user.email,
        token_hash=th,
        purpose=AccountTokenPurpose.USER_INVITE,
        expires_at=expires,
        created_by_user_id=actor.id,
        request_ip_hash=None,
        user_agent_hash=None,
        invite_meta=meta,
    )
    db_session.flush()

    invite_url = build_frontend_url(settings, "/accept-invite", {"token": raw})
    company_name: str | None = None
    if company_id is not None:
        company = get_company_by_id(db_session, company_id)
        if company is not None:
            company_name = company.name
    dev_link: str | None = None
    if smtp_delivery_configured(settings):
        try:
            subj, text = _invite_email_body(
                invite_url=invite_url,
                note=body.personal_message,
                company_name=company_name,
                role=body.system_role,
            )
            send_plain_email(settings, to_address=user.email, subject=subj, body=text)
        except RuntimeError as exc:
            logger.exception("Invite email send failed.")
            raise ValueError("Could not send invite email.") from exc
    elif _is_local_env():
        dev_link = invite_url

    create_internal_audit_event(
        db_session,
        actor,
        action="auth.user_invited",
        entity_type="user",
        entity_id=str(user.id),
        company_id=company_id if actor.system_role == SystemRole.ADMINISTRATOR else None,
        details={
            "actor_user_id": str(actor.id),
            "invited_user_id": str(user.id),
            "email_domain": user.email.split("@")[-1] if "@" in user.email else "",
        },
    )

    db_session.refresh(user)
    return InviteUserResponse(user=UserResponse.model_validate(user), dev_invite_link=dev_link)


def accept_user_invite(db_session: Session, body: AcceptInviteRequest) -> None:
    th = hash_account_token(body.token.strip())
    row = token_repo.get_unused_token_by_hash(db_session, th, AccountTokenPurpose.USER_INVITE)
    now = datetime.now(timezone.utc)
    if row is None or row.expires_at < now:
        raise ValueError("invalid_token")

    user = get_user_by_id(db_session, row.user_id)
    if user is None:
        raise ValueError("invalid_token")

    user.password_hash = hash_password(body.new_password)
    user.is_active = True
    user.invite_accepted_at = now
    user.email_verified_at = now
    user.password_changed_at = now
    token_repo.mark_token_used(db_session, row)

    fn = (body.first_name or "").strip() or None
    ln = (body.last_name or "").strip() or None
    if fn is None and ln is None and row.invite_meta:
        fn = (row.invite_meta.get("first_name") or "").strip() or None
        ln = (row.invite_meta.get("last_name") or "").strip() or None

    profile = get_employee_profile_by_user_id(db_session, user.id)
    if profile is not None:
        if fn:
            profile.first_name = fn
        if ln:
            profile.last_name = ln
        update_employee_profile(db_session, profile)
    elif fn or ln:
        if user.company_id is None:
            pass
        else:
            save_employee_profile(
                db_session,
                EmployeeProfile(
                    user_id=user.id,
                    company_id=user.company_id,
                    first_name=fn,
                    last_name=ln,
                    job_title=None,
                ),
            )

    update_user(db_session, user)

    create_internal_audit_event(
        db_session,
        user,
        action="auth.invite_accepted",
        entity_type="user",
        entity_id=str(user.id),
        company_id=user.company_id if user.system_role != SystemRole.ADMINISTRATOR else None,
        details={"user_id": str(user.id)},
    )


def send_email_verification(
    db_session: Session,
    actor: User,
    *,
    ip: str | None,
    ua: str | None,
) -> tuple[str, str | None]:
    if actor.email_verified_at is not None:
        return "Your email is already verified.", None

    if not smtp_delivery_configured(settings) and not _is_local_env():
        raise ValueError("Email delivery must be configured to send verification email.")

    since = datetime.now(timezone.utc) - timedelta(hours=2)
    if token_repo.count_recent_tokens(db_session, actor.id, AccountTokenPurpose.EMAIL_VERIFICATION, since=since) >= 8:
        raise ValueError("verification_throttled")

    raw = generate_raw_account_token()
    th = hash_account_token(raw)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=EMAIL_VERIFY_HOURS)
    ip_h, ua_h = _peer_hashes(ip, ua)
    token_repo.invalidate_unused_tokens_for_user_purpose(db_session, actor.id, AccountTokenPurpose.EMAIL_VERIFICATION)
    token_repo.insert_account_token(
        db_session,
        user_id=actor.id,
        email_normalized=actor.email,
        token_hash=th,
        purpose=AccountTokenPurpose.EMAIL_VERIFICATION,
        expires_at=expires,
        created_by_user_id=actor.id,
        request_ip_hash=ip_h,
        user_agent_hash=ua_h,
        invite_meta=None,
    )
    db_session.flush()

    verify_url = build_frontend_url(settings, "/verify-email", {"token": raw})
    dev_link: str | None = None

    if smtp_delivery_configured(settings):
        try:
            subj, text = _verify_email_body(verify_url=verify_url)
            send_plain_email(settings, to_address=actor.email, subject=subj, body=text)
        except RuntimeError:
            logger.exception("Verification email send failed.")
            raise ValueError("Could not send verification email.") from None
    elif _is_local_env():
        dev_link = verify_url

    create_internal_audit_event(
        db_session,
        actor,
        action="auth.email_verification_sent",
        entity_type="user",
        entity_id=str(actor.id),
        company_id=actor.company_id if actor.system_role != SystemRole.ADMINISTRATOR else None,
        details={"user_id": str(actor.id)},
    )

    msg = "Verification email sent." if smtp_delivery_configured(settings) else "Verification link prepared."
    return msg, dev_link


def verify_email_with_token(db_session: Session, raw_token: str) -> None:
    th = hash_account_token(raw_token.strip())
    row = token_repo.get_unused_token_by_hash(db_session, th, AccountTokenPurpose.EMAIL_VERIFICATION)
    now = datetime.now(timezone.utc)
    if row is None or row.expires_at < now:
        raise ValueError("invalid_token")

    user = get_user_by_id(db_session, row.user_id)
    if user is None:
        raise ValueError("invalid_token")

    user.email_verified_at = now
    token_repo.mark_token_used(db_session, row)
    update_user(db_session, user)

    create_internal_audit_event(
        db_session,
        user,
        action="auth.email_verified",
        entity_type="user",
        entity_id=str(user.id),
        company_id=user.company_id if user.system_role != SystemRole.ADMINISTRATOR else None,
        details={"user_id": str(user.id)},
    )
