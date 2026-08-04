"""Face-reference display orientation: EXIF transpose before thumb/full encode."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image, ImageOps

from app.modules.auth.models import SystemRole, User
from app.modules.employee_profiles.face_reference_service import (
    FaceReferenceNotFoundError,
    _make_face_reference_thumbnail,
    _normalize_face_reference_for_display,
    resolve_face_reference_image,
)


def _user(*, role: SystemRole = SystemRole.ADMIN, company_id: uuid.UUID | None = None) -> User:
    now = datetime.now(timezone.utc)
    return User(
        id=uuid.uuid4(),
        company_id=company_id or uuid.uuid4(),
        email="user@example.com",
        password_hash="hashed",
        system_role=role,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _solid_jpeg(width: int, height: int, *, color: tuple[int, int, int] = (40, 120, 200)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (width, height), color=color).save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _jpeg_with_orientation(
    *,
    stored_width: int,
    stored_height: int,
    orientation: int,
    color: tuple[int, int, int] = (10, 200, 30),
) -> bytes:
    """Create a JPEG whose pixel buffer is stored_width×stored_height with EXIF Orientation set.

    After ImageOps.exif_transpose, orientation 6/8 swap width/height for the upright image.
    """
    buf = BytesIO()
    image = Image.new("RGB", (stored_width, stored_height), color=color)
    # Mark a bright pixel at the "top" of the logical subject before EXIF rotate:
    # for orientation 6, cameras store landscape pixels; upright head is along the short edge.
    image.putpixel((stored_width // 2, 0), (255, 0, 0))
    exif = image.getexif()
    exif[274] = orientation
    image.save(buf, format="JPEG", quality=90, exif=exif.tobytes())
    return buf.getvalue()


def _output_orientation(data: bytes) -> int | None:
    with Image.open(BytesIO(data)) as image:
        value = image.getexif().get(274)
        return int(value) if value is not None else None


def test_orientation_1_unchanged_dimensions() -> None:
    source = _jpeg_with_orientation(stored_width=120, stored_height=160, orientation=1)
    out, media = _normalize_face_reference_for_display(source, variant="full")
    assert media == "image/jpeg"
    with Image.open(BytesIO(out)) as image:
        assert image.size == (120, 160)
    assert _output_orientation(out) in (None, 1)


def test_orientation_3_upright_and_strips_tag() -> None:
    source = _jpeg_with_orientation(stored_width=100, stored_height=140, orientation=3)
    out, _media = _normalize_face_reference_for_display(source, variant="full")
    with Image.open(BytesIO(out)) as image:
        assert image.size == (100, 140)
    assert _output_orientation(out) in (None, 1)


@pytest.mark.parametrize("orientation", [6, 8])
def test_orientation_6_and_8_swap_to_upright_portrait(orientation: int) -> None:
    # Stored as landscape; EXIF says rotate to portrait.
    source = _jpeg_with_orientation(stored_width=160, stored_height=120, orientation=orientation)
    out, _media = _normalize_face_reference_for_display(source, variant="full")
    with Image.open(BytesIO(out)) as image:
        assert image.size == (120, 160)
    assert _output_orientation(out) in (None, 1)


@pytest.mark.parametrize("orientation", [2, 4, 5, 7])
def test_mirrored_orientations_normalize(orientation: int) -> None:
    source = _jpeg_with_orientation(stored_width=90, stored_height=110, orientation=orientation)
    out, media = _normalize_face_reference_for_display(source, variant="full")
    assert media == "image/jpeg"
    assert out.startswith(b"\xff\xd8")
    assert _output_orientation(out) in (None, 1)
    # Round-trip through Pillow transpose of source matches display size.
    with Image.open(BytesIO(source)) as raw:
        expected = ImageOps.exif_transpose(raw)
        with Image.open(BytesIO(out)) as upright:
            assert upright.size == expected.size


def test_thumbnail_applies_exif_before_resize() -> None:
    source = _jpeg_with_orientation(stored_width=400, stored_height=300, orientation=6)
    thumb, media = _make_face_reference_thumbnail(source, max_edge=96)
    assert media == "image/jpeg"
    with Image.open(BytesIO(thumb)) as image:
        assert max(image.size) <= 96
        # After orient 6, upright is 300×400 portrait, then thumbnails preserving aspect.
        assert image.size[1] >= image.size[0]
    assert _output_orientation(thumb) in (None, 1)


def test_thumbnail_and_full_share_upright_aspect() -> None:
    source = _jpeg_with_orientation(stored_width=320, stored_height=240, orientation=8)
    full, _ = _normalize_face_reference_for_display(source, variant="full")
    thumb, _ = _normalize_face_reference_for_display(source, variant="thumb", max_edge=96)
    with Image.open(BytesIO(full)) as full_img, Image.open(BytesIO(thumb)) as thumb_img:
        assert full_img.size == (240, 320)
        assert thumb_img.size[1] >= thumb_img.size[0]
        full_ratio = full_img.size[0] / full_img.size[1]
        thumb_ratio = thumb_img.size[0] / thumb_img.size[1]
        assert abs(full_ratio - thumb_ratio) < 0.05


def test_no_exif_jpeg_still_works() -> None:
    source = _solid_jpeg(180, 220)
    out, media = _normalize_face_reference_for_display(source, variant="thumb")
    assert media == "image/jpeg"
    with Image.open(BytesIO(out)) as image:
        assert max(image.size) <= 96


def test_png_converts_to_upright_jpeg() -> None:
    buf = BytesIO()
    Image.new("RGB", (80, 100), color=(1, 2, 3)).save(buf, format="PNG")
    out, media = _normalize_face_reference_for_display(buf.getvalue(), variant="full")
    assert media == "image/jpeg"
    with Image.open(BytesIO(out)) as image:
        assert image.format == "JPEG"
        assert image.size == (80, 100)


def test_corrupt_image_fails_safely() -> None:
    with pytest.raises(ValueError):
        _normalize_face_reference_for_display(b"not-an-image", variant="thumb")


@patch("app.modules.employee_profiles.face_reference_service.create_internal_audit_event")
@patch("app.modules.employee_profiles.face_reference_service.get_storage_backend")
@patch("app.modules.employee_profiles.face_reference_service.get_employee_profile_by_user_id")
@patch("app.modules.employee_profiles.face_reference_service.get_user_by_id")
def test_resolve_serves_oriented_thumb_and_full(
    mock_get_user: MagicMock,
    mock_get_profile: MagicMock,
    mock_storage: MagicMock,
    _mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    subject = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    source = _jpeg_with_orientation(stored_width=200, stored_height=150, orientation=6)
    profile = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=subject.id,
        company_id=company_id,
        face_check_consent_at=datetime.now(timezone.utc),
        face_reference_storage_path="face-references/demo.jpg",
    )
    mock_get_user.return_value = subject
    mock_get_profile.return_value = profile
    mock_storage.return_value = SimpleNamespace(
        exists=MagicMock(return_value=True),
        read_bytes=MagicMock(return_value=source),
    )

    thumb_body, thumb_media, thumb_name, _ = resolve_face_reference_image(
        MagicMock(),
        admin,
        subject.id,
        variant="thumb",
    )
    full_body, full_media, full_name, _ = resolve_face_reference_image(
        MagicMock(),
        admin,
        subject.id,
        variant="full",
    )

    assert thumb_media == "image/jpeg"
    assert full_media == "image/jpeg"
    assert thumb_name.endswith("-thumb.jpg")
    assert full_name.endswith(".jpg")
    with Image.open(BytesIO(thumb_body)) as thumb_img, Image.open(BytesIO(full_body)) as full_img:
        assert full_img.size == (150, 200)
        assert max(thumb_img.size) <= 96
        assert thumb_img.size[1] >= thumb_img.size[0]
    assert _output_orientation(thumb_body) in (None, 1)
    assert _output_orientation(full_body) in (None, 1)


@patch("app.modules.employee_profiles.face_reference_service.create_internal_audit_event")
@patch("app.modules.employee_profiles.face_reference_service.get_storage_backend")
@patch("app.modules.employee_profiles.face_reference_service.get_employee_profile_by_user_id")
@patch("app.modules.employee_profiles.face_reference_service.get_user_by_id")
def test_resolve_corrupt_stored_bytes_returns_not_found(
    mock_get_user: MagicMock,
    mock_get_profile: MagicMock,
    mock_storage: MagicMock,
    _mock_audit: MagicMock,
) -> None:
    company_id = uuid.uuid4()
    admin = _user(role=SystemRole.ADMIN, company_id=company_id)
    subject = _user(role=SystemRole.EMPLOYEE, company_id=company_id)
    profile = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=subject.id,
        company_id=company_id,
        face_check_consent_at=datetime.now(timezone.utc),
        face_reference_storage_path="face-references/demo.jpg",
    )
    mock_get_user.return_value = subject
    mock_get_profile.return_value = profile
    mock_storage.return_value = SimpleNamespace(
        exists=MagicMock(return_value=True),
        read_bytes=MagicMock(return_value=b"corrupt"),
    )
    with pytest.raises(FaceReferenceNotFoundError):
        resolve_face_reference_image(MagicMock(), admin, subject.id, variant="thumb")
