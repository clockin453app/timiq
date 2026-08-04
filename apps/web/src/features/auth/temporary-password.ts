/**
 * Secure temporary passwords for admin create/reset flows.
 * Values are shown only in the authorised admin UI for the intended action.
 */

export const TEMPORARY_PASSWORD_MIN_LENGTH = 12;
export const GENERATED_TEMPORARY_PASSWORD_LENGTH = 16;

/** Known placeholder passwords that must never be accepted. */
export const FORBIDDEN_TEMPORARY_PASSWORDS = new Set(
  ["Admin12345", "Employee12345", "admin12345", "employee12345", "Password123", "password123"].map(
    (value) => value.toLowerCase(),
  ),
);

/** Ambiguous characters omitted from generated passwords. */
const GENERATED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";

export type TemporaryPasswordValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateTemporaryPassword(password: string): TemporaryPasswordValidation {
  if (!password) {
    return { ok: false, message: "Enter a temporary password." };
  }
  if (password.trim() !== password) {
    return { ok: false, message: "Password cannot start or end with spaces." };
  }
  if (password.length < TEMPORARY_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${TEMPORARY_PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (FORBIDDEN_TEMPORARY_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      message: "Choose a stronger password. Known placeholder passwords are not allowed.",
    };
  }
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  if (!hasLetter || !hasNumber) {
    return { ok: false, message: "Password must include at least one letter and one number." };
  }
  return { ok: true };
}

export function generateSecureTemporaryPassword(
  length: number = GENERATED_TEMPORARY_PASSWORD_LENGTH,
): string {
  if (length < TEMPORARY_PASSWORD_MIN_LENGTH) {
    throw new Error("Generated password length is too short.");
  }
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random generation is not available in this browser.");
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => GENERATED_ALPHABET[byte % GENERATED_ALPHABET.length]);

  // Guarantee letter + digit presence without logging the result.
  const letterIndex = bytes[0] % length;
  const digitIndex = (letterIndex + 1 + (bytes[1] % (length - 1))) % length;
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  chars[letterIndex] = letters[bytes[2] % letters.length];
  chars[digitIndex] = digits[bytes[3] % digits.length];

  return chars.join("");
}
