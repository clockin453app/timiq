import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_admin_or_administrator,
)
from app.modules.auth.models import User
from app.modules.auth.repository import list_users_visible_to_user
from app.modules.auth.schemas import (
    AdminCreateUserRequest,
    LoginRequest,
    LoginResponse,
    UserPasswordResetRequest,
    UserResponse,
    UserStatusUpdateRequest,
    UserUpdateRequest,
)
from app.modules.auth.service import (
    CompanyNotFoundError,
    DuplicateEmailError,
    PermissionDeniedError,
    UserNotFoundError,
    authenticate_user,
    create_user_by_admin,
    reset_user_password_by_admin,
    update_user_by_admin,
    update_user_status_by_admin,
)
from app.modules.auth.session_tokens import SESSION_COOKIE_NAME, create_session_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(
    request: LoginRequest,
    response: Response,
    db_session: Session = Depends(get_db_session),
) -> LoginResponse:
    user = authenticate_user(db_session, request.email, request.password)

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    session_token = create_session_token(user.id)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=60 * 60 * 10,
        path="/",
    )

    return LoginResponse(user=UserResponse.model_validate(user))


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
    )

    return {"status": "ok"}


@router.get("/users", response_model=list[UserResponse])
def get_users(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[UserResponse]:
    users = list_users_visible_to_user(db_session, current_user)
    return [UserResponse.model_validate(user) for user in users]


@router.post(
    "/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_managed_user(
    request: AdminCreateUserRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> UserResponse:
    try:
        user = create_user_by_admin(
            db_session=db_session,
            creator=current_user,
            request=request,
        )
    except DuplicateEmailError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        ) from exc
    except CompanyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        ) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return UserResponse.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_managed_user(
    user_id: uuid.UUID,
    request: UserUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> UserResponse:
    try:
        user = update_user_by_admin(
            db_session=db_session,
            actor=current_user,
            user_id=user_id,
            request=request,
        )
    except UserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except DuplicateEmailError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        ) from exc
    except CompanyNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        ) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return UserResponse.model_validate(user)


@router.patch("/users/{user_id}/status", response_model=UserResponse)
def update_managed_user_status(
    user_id: uuid.UUID,
    request: UserStatusUpdateRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> UserResponse:
    try:
        user = update_user_status_by_admin(
            db_session=db_session,
            actor=current_user,
            user_id=user_id,
            is_active=request.is_active,
        )
    except UserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return UserResponse.model_validate(user)


@router.patch("/users/{user_id}/password", response_model=UserResponse)
def reset_managed_user_password(
    user_id: uuid.UUID,
    request: UserPasswordResetRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> UserResponse:
    try:
        user = reset_user_password_by_admin(
            db_session=db_session,
            actor=current_user,
            user_id=user_id,
            request=request,
        )
    except UserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return UserResponse.model_validate(user)