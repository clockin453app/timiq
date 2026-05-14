import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db_session
from app.modules.auth.dependencies import (
    get_current_user,
    require_admin_or_administrator,
    require_authenticated_employee,
    require_administrator,
)
from app.modules.auth.models import User
from app.modules.auth.repository import list_users_visible_to_user_with_profile_names
from app.modules.auth.schemas import (
    AcceptInviteRequest,
    AdminCreateUserRequest,
    ForgotPasswordRequest,
    GenericMessageResponse,
    InviteUserRequest,
    InviteUserResponse,
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    ResetPasswordWithTokenRequest,
    SendVerificationEmailResponse,
    UserPasswordResetRequest,
    UserResponse,
    UserStatusUpdateRequest,
    UserUpdateRequest,
    VerifyEmailTokenRequest,
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
from app.modules.auth.user_lifecycle import (
    ClearHistoryPermissionError,
    DeleteUserPermissionError,
    UserHasOperationalHistoryError,
    clear_user_operational_history,
    delete_user_hard_by_administrator,
)
from app.core.config import settings
from app.modules.auth.session_tokens import SESSION_COOKIE_NAME, create_session_token
from app.modules.auth.account_access_service import (
    accept_user_invite,
    change_my_password,
    complete_password_reset_with_token,
    invite_user_by_email,
    request_forgot_password,
    send_email_verification,
    verify_email_with_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _session_cookie_params() -> dict[str, bool | str]:
    """Local dev: lax + not secure. Production (split origins): Secure + None so API cookies work cross-site."""
    is_local = settings.app_env.strip().lower() == "local"
    if is_local:
        return {"secure": False, "samesite": "lax"}
    return {"secure": True, "samesite": "none"}


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

    cookie_kw = _session_cookie_params()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        max_age=60 * 60 * 10,
        path="/",
        **cookie_kw,
    )

    return LoginResponse(user=UserResponse.model_validate(user))


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordChangeRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> Response:
    try:
        change_my_password(db_session, current_user, body)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/forgot-password", response_model=GenericMessageResponse)
def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> GenericMessageResponse:
    client_key = request.client.host if request.client else "unknown"
    try:
        message = request_forgot_password(db_session, email=body.email, client_key=client_key)
    except ValueError as exc:
        if str(exc) == "rate_limited":
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again later.",
            ) from exc
        raise
    return GenericMessageResponse(message=message)


@router.post("/reset-password", response_model=GenericMessageResponse)
def reset_password_with_token(
    body: ResetPasswordWithTokenRequest,
    db_session: Session = Depends(get_db_session),
) -> GenericMessageResponse:
    try:
        complete_password_reset_with_token(db_session, body)
    except ValueError as exc:
        if str(exc) == "invalid_token":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This reset link is invalid or has expired.",
            ) from exc
        raise
    return GenericMessageResponse(message="Your password has been updated. You can sign in now.")


@router.post("/admin/invite-user", response_model=InviteUserResponse, response_model_exclude_none=True)
def invite_user_route(
    body: InviteUserRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> InviteUserResponse:
    try:
        return invite_user_by_email(db_session, current_user, body)
    except DuplicateEmailError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        ) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except CompanyNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/accept-invite", response_model=GenericMessageResponse)
def accept_invite_route(
    body: AcceptInviteRequest,
    db_session: Session = Depends(get_db_session),
) -> GenericMessageResponse:
    try:
        accept_user_invite(db_session, body)
    except ValueError as exc:
        if str(exc) == "invalid_token":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This invitation link is invalid or has expired.",
            ) from exc
        raise
    return GenericMessageResponse(message="Your account is ready. You can sign in now.")


@router.post("/send-verification-email", response_model=SendVerificationEmailResponse, response_model_exclude_none=True)
def send_verification_email_route(
    request: Request,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_authenticated_employee),
) -> SendVerificationEmailResponse:
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    try:
        message, dev_link = send_email_verification(db_session, current_user, ip=ip, ua=ua)
    except ValueError as exc:
        if str(exc) == "verification_throttled":
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many verification emails requested. Try again later.",
            ) from exc
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return SendVerificationEmailResponse(message=message, dev_verification_link=dev_link)


@router.post("/verify-email", response_model=GenericMessageResponse)
def verify_email_route(
    body: VerifyEmailTokenRequest,
    db_session: Session = Depends(get_db_session),
) -> GenericMessageResponse:
    try:
        verify_email_with_token(db_session, body.token)
    except ValueError as exc:
        if str(exc) == "invalid_token":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This verification link is invalid or has expired.",
            ) from exc
        raise
    return GenericMessageResponse(message="Your email has been verified.")


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    cookie_kw = _session_cookie_params()
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=bool(cookie_kw.get("secure")),
        samesite=str(cookie_kw.get("samesite", "lax")),
    )

    return {"status": "ok"}


@router.get("/users", response_model=list[UserResponse])
def get_users(
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[UserResponse]:
    rows = list_users_visible_to_user_with_profile_names(db_session, current_user)
    return [
        UserResponse.model_validate(user).model_copy(
            update={
                "profile_first_name": first_name,
                "profile_last_name": last_name,
                "profile_job_title": (job_title or "").strip() or None,
            },
        )
        for user, first_name, last_name, job_title in rows
    ]


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


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_managed_user_hard(
    user_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_administrator),
) -> Response:
    try:
        delete_user_hard_by_administrator(
            db_session=db_session,
            actor=current_user,
            user_id=user_id,
        )
    except UserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except DeleteUserPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except UserHasOperationalHistoryError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{user_id}/clear-history", status_code=status.HTTP_204_NO_CONTENT)
def clear_managed_user_history(
    user_id: uuid.UUID,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_administrator),
) -> Response:
    try:
        clear_user_operational_history(
            db_session=db_session,
            actor=current_user,
            user_id=user_id,
        )
    except UserNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        ) from exc
    except ClearHistoryPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


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