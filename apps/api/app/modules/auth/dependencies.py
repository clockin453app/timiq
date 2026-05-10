from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.models import SystemRole, User
from app.modules.auth.repository import get_user_by_id
from app.modules.auth.session_tokens import (
    InvalidSessionTokenError,
    SESSION_COOKIE_NAME,
    read_session_token,
)


def get_current_user(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> User:
    token = request.cookies.get(SESSION_COOKIE_NAME)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
        )

    try:
        user_id = read_session_token(token)
    except InvalidSessionTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session.",
        ) from exc

    user = get_user_by_id(db_session, user_id)

    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User is not active.",
        )

    return user


def require_roles(*allowed_roles: SystemRole):
    def role_dependency(current_user: User = Depends(get_current_user)) -> User:
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