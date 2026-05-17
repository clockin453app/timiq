from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.limited_access import has_limited_access
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.session_tokens import (
    InvalidSessionTokenError,
    SESSION_COOKIE_NAME,
    read_session_token,
)

_DEACTIVATED_DETAIL = "Your account is deactivated."


def get_authenticated_user(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> User:
    """Valid session; includes deactivated employees with limited access."""
    token = request.cookies.get(SESSION_COOKIE_NAME)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )

    try:
        claims = read_session_token(token)
    except InvalidSessionTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session.",
        ) from exc

    user = get_user_by_id(db_session, claims.user_id)

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )

    if user.active_session_id is None or user.active_session_id != claims.session_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session.",
        )

    request.state.auth_session_id = claims.session_id

    return user


def require_active_user(
    current_user: User = Depends(get_authenticated_user),
) -> User:
    """Normal protected actions — active accounts only."""
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_DEACTIVATED_DETAIL,
        )
    return current_user


def require_authenticated_employee_self_service(
    current_user: User = Depends(get_authenticated_user),
) -> User:
    """Own timesheets / pay history / profile for active or limited-access employees."""
    if current_user.is_active:
        return current_user
    if has_limited_access(current_user):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=_DEACTIVATED_DETAIL,
    )


# Backward-compatible alias used across routers.
get_current_user = require_active_user


def require_roles(*allowed_roles: SystemRole):
    def role_dependency(current_user: User = Depends(require_active_user)) -> User:
        if current_user.system_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )

        return current_user

    return role_dependency


require_administrator = require_roles(SystemRole.ADMINISTRATOR)

require_admin_or_administrator = require_roles(
    SystemRole.ADMINISTRATOR,
    SystemRole.ADMIN,
)

require_authenticated_employee = require_roles(
    SystemRole.ADMINISTRATOR,
    SystemRole.ADMIN,
    SystemRole.EMPLOYEE,
)
