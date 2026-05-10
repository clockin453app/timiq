import base64
import hashlib
import hmac
import secrets


PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 600_000
PASSWORD_SALT_BYTES = 32


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("Password is required.")

    salt = secrets.token_bytes(PASSWORD_SALT_BYTES)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_HASH_ITERATIONS,
    )

    salt_b64 = base64.urlsafe_b64encode(salt).decode("utf-8")
    hash_b64 = base64.urlsafe_b64encode(password_hash).decode("utf-8")

    return (
        f"{PASSWORD_HASH_ALGORITHM}"
        f"${PASSWORD_HASH_ITERATIONS}"
        f"${salt_b64}"
        f"${hash_b64}"
    )


def verify_password(password: str, stored_password_hash: str) -> bool:
    if not password or not stored_password_hash:
        return False

    try:
        algorithm, iterations_text, salt_b64, hash_b64 = stored_password_hash.split("$")
        iterations = int(iterations_text)
    except ValueError:
        return False

    if algorithm != PASSWORD_HASH_ALGORITHM:
        return False

    salt = base64.urlsafe_b64decode(salt_b64.encode("utf-8"))
    expected_hash = base64.urlsafe_b64decode(hash_b64.encode("utf-8"))

    actual_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    )

    return hmac.compare_digest(actual_hash, expected_hash)


def password_needs_rehash(stored_password_hash: str) -> bool:
    try:
        algorithm, iterations_text, _, _ = stored_password_hash.split("$")
        iterations = int(iterations_text)
    except ValueError:
        return True

    return algorithm != PASSWORD_HASH_ALGORITHM or iterations < PASSWORD_HASH_ITERATIONS