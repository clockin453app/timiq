from app.modules.auth.models import SystemRole, User
from app.modules.auth.service import can_manage_user
from app.modules.onboarding.models import OnboardingDocument, OnboardingSubmission


def is_submission_owner(actor: User, submission: OnboardingSubmission) -> bool:
    return actor.id == submission.user_id


def can_employee_edit_submission(actor: User, submission: OnboardingSubmission) -> bool:
    if submission.status != "draft":
        return False
    return is_submission_owner(actor, submission)


def can_view_submission_as_owner(actor: User, submission: OnboardingSubmission) -> bool:
    return is_submission_owner(actor, submission)


def can_admin_review_user(actor: User, subject: User) -> bool:
    if actor.system_role not in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        return False
    return can_manage_user(actor, subject)


def can_access_document_file(
    actor: User,
    submission: OnboardingSubmission,
    document: OnboardingDocument,
    owner: User,
) -> bool:
    if document.submission_id != submission.id:
        return False
    if is_submission_owner(actor, submission):
        return True
    if actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        return can_manage_user(actor, owner)
    return False


def can_access_signature_image(
    actor: User,
    submission: OnboardingSubmission,
    owner: User,
) -> bool:
    if is_submission_owner(actor, submission):
        return True
    if actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        return can_manage_user(actor, owner)
    return False


def can_access_profile_photo_file(actor: User, owner: User) -> bool:
    if actor.id == owner.id:
        return True
    if actor.system_role in (SystemRole.ADMIN, SystemRole.ADMINISTRATOR):
        return can_manage_user(actor, owner)
    return False
