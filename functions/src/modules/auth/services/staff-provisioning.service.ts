import {auth, firestore} from "../../../config/firebase";

const VALID_ROLES = new Set(["admin", "manager", "surveyor"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateStaffUserInput {
  email: string;
  password: string;
  role: string;
  firstName: string;
  lastName: string;
  company: string;
  designation: string;
  mobile: string;
  countryCode: string;
  callerUid: string;
}

export interface CreateStaffUserResult {
  uid: string;
  email: string;
  role: string;
}

/** Typed error thrown by the staff provisioning service. */
export class ProvisioningError extends Error {
  /**
   * Build a ProvisioningError with a stable error code and field hint.
   * @param {string} code Stable error code.
   * @param {string} message Human-readable description.
   * @param {string} [field] Field name that triggered the error.
   */
  constructor(
    public readonly code:
      | "invalid-argument"
      | "already-exists"
      | "failed-precondition"
      | "internal",
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * Coerce, trim, and length-check a required string field.
 * @param {unknown} v Raw value from the payload.
 * @param {string} field Field name (for error messages).
 * @param {number} [max] Maximum allowed length after trimming.
 * @return {string} Trimmed, validated string.
 */
function requireString(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string") {
    throw new ProvisioningError(
      "invalid-argument", `${field} must be a string.`, field);
  }
  const trimmed = v.trim();
  if (!trimmed) {
    throw new ProvisioningError(
      "invalid-argument", `${field} is required.`, field);
  }
  if (trimmed.length > max) {
    throw new ProvisioningError(
      "invalid-argument", `${field} is too long.`, field);
  }
  return trimmed;
}

/**
 * Coerce and trim an optional string field. Empty/null becomes "".
 * @param {unknown} v Raw value from the payload.
 * @param {string} field Field name (for error messages).
 * @param {number} [max] Maximum allowed length after trimming.
 * @return {string} Trimmed value or "".
 */
function optionalString(v: unknown, field: string, max = 200): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") {
    throw new ProvisioningError(
      "invalid-argument", `${field} must be a string.`, field);
  }
  const trimmed = v.trim();
  if (trimmed.length > max) {
    throw new ProvisioningError(
      "invalid-argument", `${field} is too long.`, field);
  }
  return trimmed;
}

/**
 * Validate and normalize the public payload for provisionStaffUser.
 * @param {object} raw Untrusted client payload.
 * @return {object} Normalized payload (sans callerUid).
 */
export function validateInput(
  raw: Partial<CreateStaffUserInput>,
): Omit<CreateStaffUserInput, "callerUid"> {
  const email = requireString(raw.email, "email", 254).toLowerCase();
  const password = requireString(raw.password, "password", 128);
  const role = requireString(raw.role, "role", 32).toLowerCase();
  const firstName = optionalString(raw.firstName, "firstName", 100);
  const lastName = optionalString(raw.lastName, "lastName", 100);
  const company = optionalString(raw.company, "company", 200);
  const designation = optionalString(raw.designation, "designation", 200);
  const mobile = optionalString(raw.mobile, "mobile", 20);
  const countryCode = optionalString(raw.countryCode, "countryCode", 6);

  if (!EMAIL_RE.test(email)) {
    throw new ProvisioningError(
      "invalid-argument", "email is not valid.", "email");
  }
  if (password.length < 6) {
    throw new ProvisioningError(
      "invalid-argument",
      "password must be at least 6 characters.",
      "password",
    );
  }
  if (!VALID_ROLES.has(role)) {
    throw new ProvisioningError(
      "invalid-argument",
      "role must be one of admin, manager, surveyor.",
      "role",
    );
  }

  return {
    email,
    password,
    role,
    firstName,
    lastName,
    company,
    designation,
    mobile,
    countryCode,
  };
}

/**
 * Provision an internal staff user (admin / manager / surveyor).
 *
 * Steps:
 *   1. Pre-check email not already used by an Auth account.
 *   2. Create the Firebase Auth user (email/password identity).
 *   3. Set custom claims { role }.
 *   4. Write the `users/{uid}` Firestore doc using the same shape as the
 *      Flutter client's UserModel.toMap().
 *
 * On any failure after the Auth user is created, the Auth user is
 * deleted to avoid orphans.
 *
 * @param {CreateStaffUserInput} input Validated payload plus caller uid.
 * @return {Promise<CreateStaffUserResult>} The new uid, email, role.
 */
export async function provisionStaffUser(
  input: CreateStaffUserInput,
): Promise<CreateStaffUserResult> {
  const db = firestore();

  // Pre-check (cheap, before we touch Auth).
  try {
    await auth().getUserByEmail(input.email);
    throw new ProvisioningError(
      "already-exists",
      "An account already exists with this email.",
      "email",
    );
  } catch (err: unknown) {
    if (err instanceof ProvisioningError) throw err;
    const code = (err as {code?: string})?.code ?? "";
    if (code !== "auth/user-not-found") {
      throw new ProvisioningError(
        "internal",
        "Failed to check existing user: " +
          `${(err as Error)?.message ?? "unknown"}`,
      );
    }
    // Not found → free to create.
  }

  const displayName = `${input.firstName} ${input.lastName}`.trim();

  // Create the Auth user.
  let uid: string;
  try {
    const created = await auth().createUser({
      email: input.email,
      password: input.password,
      displayName: displayName || undefined,
      disabled: false,
    });
    uid = created.uid;
  } catch (err: unknown) {
    const code = (err as {code?: string})?.code ?? "";
    if (code === "auth/email-already-exists") {
      throw new ProvisioningError(
        "already-exists",
        "An account already exists with this email.",
        "email",
      );
    }
    if (code === "auth/invalid-email") {
      throw new ProvisioningError(
        "invalid-argument", "Email is invalid.", "email");
    }
    if (code === "auth/invalid-password" || code === "auth/weak-password") {
      throw new ProvisioningError(
        "invalid-argument",
        "Password is too weak. Use at least 6 characters.",
        "password",
      );
    }
    throw new ProvisioningError(
      "internal",
      `Failed to create auth user: ${(err as Error)?.message ?? "unknown"}`,
    );
  }

  // From here on, any failure must roll back the Auth user.
  try {
    await auth().setCustomUserClaims(uid, {role: input.role});

    const nowIso = new Date().toISOString();
    await db.collection("users").doc(uid).set({
      uid,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      company: input.company,
      designation: input.designation,
      mobile: input.mobile,
      countryCode: input.countryCode,
      photoUrl: "",
      isActive: true,
      createdAt: nowIso,
      lastLoginAt: "",
      createdBy: input.callerUid,
    });

    return {uid, email: input.email, role: input.role};
  } catch (err) {
    await safeDeleteAuthUser(uid);
    if (err instanceof ProvisioningError) throw err;
    throw new ProvisioningError(
      "internal",
      `Failed to persist user: ${(err as Error)?.message ?? "unknown"}`,
    );
  }
}

/**
 * Best-effort delete of an Auth user; swallows errors.
 * @param {string} uid Firebase Auth uid to delete.
 * @return {Promise<void>} Resolves once the attempt completes.
 */
async function safeDeleteAuthUser(uid: string): Promise<void> {
  try {
    await auth().deleteUser(uid);
  } catch {
    // Best-effort cleanup; original error wins.
  }
}
