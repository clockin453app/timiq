import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.auth.models import SystemRole


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
    created_at: datetime
    updated_at: datetime
    profile_first_name: Optional[str] = None
    profile_last_name: Optional[str] = None


class LoginResponse(BaseModel):
    user: UserResponse


class UserStatusUpdateRequest(BaseModel):
    is_active: bool


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_strength(cls, value: str) -> str:
        return validate_password_strength_value(value)