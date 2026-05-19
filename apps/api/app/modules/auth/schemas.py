import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.auth.limited_access import has_limited_access
from app.modules.auth.models import SystemRole, User


def normalize_email_value(value: str) -> str:
    normalized = value.strip().lower()

    if "@" not in normalized or "." not in normalized.split("@")[-1]:
        raise ValueError("Enter a valid email address.")

    return normalized


def validate_password_strength_value(value: str) -> str:
    if value.strip() != value:
        raise ValueError("Password cannot start or end with spaces.")

    has_letter = any(character.isalpha() for character in value)
    has_number = any(character.isdigit() for character in value)

    if not has_letter or not has_number:
        raise ValueError("Password must include at least one letter and one number.")

    return value


ACCOUNT_PASSWORD_MIN_LENGTH = 12


def validate_account_password(value: str) -> str:
    """Self-service password rules (change, reset, invite accept): min length + letter + number."""
    if len(value) < ACCOUNT_PASSWORD_MIN_LENGTH:
        raise ValueError(f"Password must be at least {ACCOUNT_PASSWORD_MIN_LENGTH} characters.")
    return validate_password_strength_value(value)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_value(value)


class UserCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=10, max_length=128)
    system_role: SystemRole = SystemRole.EMPLOYEE

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_value(value)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        return validate_password_strength_value(value)


class AdminCreateUserRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=10, max_length=128)
    system_role: SystemRole = SystemRole.EMPLOYEE
    is_active: bool = True
    company_id: Optional[uuid.UUID] = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_value(value)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        return validate_password_strength_value(value)


class UserUpdateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    system_role: SystemRole
    company_id: Optional[uuid.UUID] = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_value(value)


class UserPasswordResetRequest(BaseModel):
    password: str = Field(min_length=10, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        return validate_password_strength_value(value)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: Optional[uuid.UUID]
    email: str
    system_role: SystemRole
    is_active: bool
    limited_access: bool = False
    created_at: datetime
    updated_at: datetime
    profile_first_name: Optional[str] = None
    profile_last_name: Optional[str] = None
    profile_job_title: Optional[str] = None
    email_verified_at: Optional[datetime] = None
    invited_at: Optional[datetime] = None
    invite_accepted_at: Optional[datetime] = None
    password_changed_at: Optional[datetime] = None


def build_user_response(
    user: User,
    *,
    profile_first_name: str | None = None,
    profile_last_name: str | None = None,
    profile_job_title: str | None = None,
) -> UserResponse:
    base = UserResponse.model_validate(user)
    return base.model_copy(
        update={
            "limited_access": has_limited_access(user),
            "profile_first_name": profile_first_name,
            "profile_last_name": profile_last_name,
            "profile_job_title": profile_job_title,
        },
    )


class LoginResponse(BaseModel):
    user: UserResponse


class UserStatusUpdateRequest(BaseModel):
    is_active: bool


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_strength(cls, value: str) -> str:
        return validate_account_password(value)


class GenericMessageResponse(BaseModel):
    message: str


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_value(value)


class ResetPasswordWithTokenRequest(BaseModel):
    token: str = Field(min_length=10, max_length=512)
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_strength(cls, value: str) -> str:
        return validate_account_password(value)


class InviteUserRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    system_role: SystemRole = SystemRole.EMPLOYEE
    company_id: Optional[uuid.UUID] = None
    first_name: Optional[str] = Field(default=None, max_length=120)
    last_name: Optional[str] = Field(default=None, max_length=120)
    job_title: Optional[str] = Field(default=None, max_length=120)
    personal_message: Optional[str] = Field(default=None, max_length=500)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return normalize_email_value(value)


class InviteUserResponse(BaseModel):
    user: UserResponse
    dev_invite_link: Optional[str] = None


class AcceptInviteRequest(BaseModel):
    token: str = Field(min_length=10, max_length=512)
    new_password: str = Field(min_length=12, max_length=128)
    first_name: Optional[str] = Field(default=None, max_length=120)
    last_name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_strength(cls, value: str) -> str:
        return validate_account_password(value)


class VerifyEmailTokenRequest(BaseModel):
    token: str = Field(min_length=10, max_length=512)


class SendVerificationEmailResponse(BaseModel):
    message: str
    dev_verification_link: Optional[str] = None