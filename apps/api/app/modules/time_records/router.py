import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.storage.file_response import content_disposition_attachment

from app.db.session import get_db_session
from app.modules.auth.dependencies import get_current_user, require_admin_or_administrator
from app.modules.auth.models import User
from app.modules.time_records.schemas import (
    AdminCreateCompletedShiftRequest,
    AdminForceClockOutRequest,
    AdminManualShiftMutationResponse,
    AdminPatchCompletedShiftRequest,
    AdminTimesheetWeekAllEmployeesResponse,
    AdminWeekReportAllEmployeesResponse,
    TimeRecordShiftRow,
    TimesheetWeekResponse,
)
from app.modules.time_records.service import (
    TimeRecordsPermissionError,
    export_admin_company_timesheet_week_csv,
    export_admin_company_week_report_csv,
    export_timesheet_week_shifts_csv,
    list_time_records_admin,
    list_time_records_me,
    timesheet_week_all_employees_for_company,
    timesheet_week_for_user,
    week_report_all_employees_for_company,
)
from app.modules.time_records.admin_manual_service import (
    AdminTimeAdjustmentError,
    admin_create_completed_shift,
    admin_force_clock_out,
    admin_patch_completed_shift,
)

time_records_router = APIRouter(prefix="/api/time-records", tags=["time-records"])
timesheets_router = APIRouter(prefix="/api/timesheets", tags=["timesheets"])


def _opt_date(raw: str | None) -> date | None:
    if raw is None or raw.strip() == "":
        return None
    return date.fromisoformat(raw.strip())


def _status_filter(raw: str | None) -> str | None:
    if raw is None or raw.strip() == "":
        return None
    cleaned = raw.strip().lower()
    if cleaned not in ("open", "completed"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="status must be open or completed.",
        )
    return cleaned


@time_records_router.get("/me", response_model=list[TimeRecordShiftRow])
def read_my_time_records(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    location_id: uuid.UUID | None = None,
    status: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[TimeRecordShiftRow]:
    try:
        return list_time_records_me(
            db_session,
            current_user,
            start_date=_opt_date(start_date),
            end_date_exclusive=_opt_date(end_date),
            location_id=location_id,
            status=_status_filter(status),
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@time_records_router.get("/admin", response_model=list[TimeRecordShiftRow])
def read_admin_time_records(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    location_id: uuid.UUID | None = None,
    status: str | None = Query(default=None),
    user_id: uuid.UUID | None = None,
    company_id: uuid.UUID | None = None,
    limit: int | None = Query(default=None, ge=1),
    offset: int | None = Query(default=None, ge=0),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> list[TimeRecordShiftRow]:
    try:
        return list_time_records_admin(
            db_session,
            current_user,
            start_date=_opt_date(start_date),
            end_date_exclusive=_opt_date(end_date),
            location_id=location_id,
            status=_status_filter(status),
            user_id=user_id,
            company_id=company_id,
            limit=limit,
            offset=offset,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@time_records_router.post("/admin/shifts", response_model=AdminManualShiftMutationResponse)
def admin_create_completed_shift_route(
    body: AdminCreateCompletedShiftRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AdminManualShiftMutationResponse:
    try:
        row, recalc, week_start, company_id = admin_create_completed_shift(
            db_session,
            current_user,
            user_id=body.user_id,
            location_id=body.location_id,
            clock_in_at=body.clock_in_at,
            clock_out_at=body.clock_out_at,
            break_seconds=body.break_seconds,
            break_minutes=body.break_minutes,
            reason=body.reason,
        )
        return AdminManualShiftMutationResponse(
            shift=row,
            payroll_recalculation_required=recalc,
            affected_week_start=week_start,
            affected_company_id=company_id,
        )
    except AdminTimeAdjustmentError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc


@time_records_router.patch("/admin/shifts/{shift_id}", response_model=AdminManualShiftMutationResponse)
def admin_patch_completed_shift_route(
    shift_id: uuid.UUID,
    body: AdminPatchCompletedShiftRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AdminManualShiftMutationResponse:
    try:
        row, recalc, week_start, company_id = admin_patch_completed_shift(
            db_session,
            current_user,
            shift_id=shift_id,
            clock_in_at=body.clock_in_at,
            clock_out_at=body.clock_out_at,
            location_id=body.location_id,
            break_seconds=body.break_seconds,
            break_minutes=body.break_minutes,
            reason=body.reason,
        )
        return AdminManualShiftMutationResponse(
            shift=row,
            payroll_recalculation_required=recalc,
            affected_week_start=week_start,
            affected_company_id=company_id,
        )
    except AdminTimeAdjustmentError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc


@time_records_router.post(
    "/admin/shifts/{shift_id}/force-clock-out",
    response_model=AdminManualShiftMutationResponse,
)
def admin_force_clock_out_route(
    shift_id: uuid.UUID,
    body: AdminForceClockOutRequest,
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AdminManualShiftMutationResponse:
    try:
        row, recalc, week_start, company_id = admin_force_clock_out(
            db_session,
            current_user,
            shift_id=shift_id,
            clock_out_at=body.clock_out_at,
            break_seconds=body.break_seconds,
            break_minutes=body.break_minutes,
            reason=body.reason,
        )
        return AdminManualShiftMutationResponse(
            shift=row,
            payroll_recalculation_required=recalc,
            affected_week_start=week_start,
            affected_company_id=company_id,
        )
    except AdminTimeAdjustmentError as exc:
        raise HTTPException(status_code=exc.http_status, detail=str(exc)) from exc


@timesheets_router.get("/me/week", response_model=TimesheetWeekResponse)
def read_my_timesheet_week(
    week_start: str = Query(..., description="Monday local date for the company policy timezone (YYYY-MM-DD)."),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> TimesheetWeekResponse:
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        return timesheet_week_for_user(
            db_session,
            current_user,
            subject_user_id=current_user.id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@timesheets_router.get("/admin/week", response_model=TimesheetWeekResponse)
def read_admin_timesheet_week(
    week_start: str = Query(...),
    user_id: uuid.UUID = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> TimesheetWeekResponse:
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        return timesheet_week_for_user(
            db_session,
            current_user,
            subject_user_id=user_id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@timesheets_router.get("/admin/company/timesheet-week", response_model=AdminTimesheetWeekAllEmployeesResponse)
def read_admin_company_timesheet_week(
    week_start: str = Query(..., description="Monday local date (YYYY-MM-DD) in company policy timezone."),
    company_id: uuid.UUID | None = Query(
        default=None,
        description="Required for administrators; ignored for company admins (own company enforced).",
    ),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AdminTimesheetWeekAllEmployeesResponse:
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        return timesheet_week_all_employees_for_company(
            db_session,
            current_user,
            company_id=company_id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        detail = str(exc)
        if "not found" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=detail,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        ) from exc


@timesheets_router.get("/me/week/export.csv")
def export_my_timesheet_week_csv(
    week_start: str = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        body, fname = export_timesheet_week_shifts_csv(
            db_session,
            current_user,
            subject_user_id=current_user.id,
            week_start=parsed,
            export_scope="me_week",
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(fname)},
    )


@timesheets_router.get("/admin/week/export.csv")
def export_admin_timesheet_week_csv_route(
    week_start: str = Query(...),
    user_id: uuid.UUID = Query(...),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
):
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        body, fname = export_timesheet_week_shifts_csv(
            db_session,
            current_user,
            subject_user_id=user_id,
            week_start=parsed,
            export_scope="admin_employee_week",
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(fname)},
    )


@timesheets_router.get("/admin/company/timesheet-week/export.csv")
def export_admin_company_timesheet_week_csv_route(
    week_start: str = Query(...),
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
):
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        body, fname = export_admin_company_timesheet_week_csv(
            db_session,
            current_user,
            company_id=company_id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        detail = str(exc)
        if "not found" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=detail,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        ) from exc
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(fname)},
    )


@timesheets_router.get("/admin/company/week-report/export.csv")
def export_admin_company_week_report_csv_route(
    week_start: str = Query(...),
    company_id: uuid.UUID | None = Query(default=None),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
):
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        body, fname = export_admin_company_week_report_csv(
            db_session,
            current_user,
            company_id=company_id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        detail = str(exc)
        if "not found" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=detail,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        ) from exc
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(fname)},
    )


@timesheets_router.get("/admin/company/week-report", response_model=AdminWeekReportAllEmployeesResponse)
def read_admin_company_week_report(
    week_start: str = Query(..., description="Monday local date (YYYY-MM-DD) in company policy timezone."),
    company_id: uuid.UUID | None = Query(
        default=None,
        description="Required for administrators; ignored for company admins (own company enforced).",
    ),
    db_session: Session = Depends(get_db_session),
    current_user: User = Depends(require_admin_or_administrator),
) -> AdminWeekReportAllEmployeesResponse:
    try:
        parsed = _opt_date(week_start)
        if parsed is None:
            raise ValueError("week_start is required.")
        return week_report_all_employees_for_company(
            db_session,
            current_user,
            company_id=company_id,
            week_start=parsed,
        )
    except TimeRecordsPermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        detail = str(exc)
        if "not found" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=detail,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        ) from exc
