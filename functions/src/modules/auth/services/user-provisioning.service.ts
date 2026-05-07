import {auth, firestore} from "../../../config/firebase";
import {FieldValue} from "firebase-admin/firestore";

export interface CreateSurveyUserInput {
  surveyId: string;
  username: string;
  password: string;
  email: string;
  phoneNumber: string;
  name: string;
  callerUid: string;
}

export interface CreateSurveyUserResult {
  uid: string;
  username: string;
}

/** Typed error thrown by the provisioning service. */
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

const USERNAME_RE = /^[a-z0-9._-]{4,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

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
 * Validate and normalize the public payload for createSurveyUser.
 * @param {object} raw Untrusted client payload.
 * @return {object} Normalized payload (sans callerUid).
 */
export function validateInput(
  raw: Partial<CreateSurveyUserInput>,
): Omit<CreateSurveyUserInput, "callerUid"> {
  const surveyId = requireString(raw.surveyId, "surveyId", 128);
  const username = requireString(raw.username, "username", 32).toLowerCase();
  const password = requireString(raw.password, "password", 128);
  const email = requireString(raw.email, "email", 254).toLowerCase();
  const phoneNumber = requireString(raw.phoneNumber, "phoneNumber", 20);
  const name = requireString(raw.name, "name", 100);

  if (!USERNAME_RE.test(username)) {
    throw new ProvisioningError(
      "invalid-argument",
      "username must be 4-32 chars, lowercase letters, digits, . _ -",
      "username",
    );
  }
  if (password.length < 8) {
    throw new ProvisioningError(
      "invalid-argument",
      "password must be at least 8 characters.",
      "password");
  }
  if (!EMAIL_RE.test(email)) {
    throw new ProvisioningError(
      "invalid-argument", "email is not valid.", "email");
  }
  if (!E164_RE.test(phoneNumber)) {
    throw new ProvisioningError(
      "invalid-argument",
      "phoneNumber must be in E.164 format (e.g. +9715XXXXXXXX).",
      "phoneNumber",
    );
  }

  return {surveyId, username, password, email, phoneNumber, name};
}

/**
 * Provision a survey-scoped user.
 *
 * Steps (in order):
 *   1. Validate survey state and username uniqueness.
 *   2. Create the Firebase Auth user (email/password identity).
 *   3. Set custom claims { role: 'user', surveyId }.
 *   4. Atomically write users/{uid}, usernames/{username}, and assign
 *      the survey to the new uid.
 *
 * On any failure after the Auth user is created, the Auth user is
 * deleted to avoid orphans.
 *
 * @param {CreateSurveyUserInput} input Validated payload plus caller uid.
 * @return {Promise<CreateSurveyUserResult>} The new user's uid + username.
 */
export async function createSurveyUser(
  input: CreateSurveyUserInput,
): Promise<CreateSurveyUserResult> {
  const db = firestore();

  const surveyRef = db.collection("surveys").doc(input.surveyId);
  const usernameRef = db.collection("usernames").doc(input.username);

  // Pre-checks (cheap, before we touch Auth).
  const [surveySnap, usernameSnap] = await Promise.all([
    surveyRef.get(),
    usernameRef.get(),
  ]);

  if (!surveySnap.exists) {
    throw new ProvisioningError(
      "failed-precondition", "Survey does not exist.", "surveyId");
  }
  const surveyData = surveySnap.data() ?? {};
  // Status is an integer (4 = Completed) per AppConstants.
  if (surveyData.status === 4) {
    throw new ProvisioningError(
      "failed-precondition", "Survey is already completed.", "surveyId");
  }
  if (typeof surveyData.assignedUid === "string" && surveyData.assignedUid) {
    throw new ProvisioningError(
      "failed-precondition",
      "Survey already has an assigned user.",
      "surveyId");
  }
  if (usernameSnap.exists) {
    throw new ProvisioningError(
      "already-exists", "Username is already taken.", "username");
  }

  // Create Auth user. Catches duplicate-email here.
  let uid: string;
  try {
    const created = await auth().createUser({
      email: input.email,
      password: input.password,
      phoneNumber: input.phoneNumber,
      displayName: input.name,
      disabled: false,
    });
    uid = created.uid;
  } catch (err: unknown) {
    const code = (err as {code?: string})?.code ?? "";
    if (code === "auth/email-already-exists") {
      throw new ProvisioningError(
        "already-exists", "Email is already registered.", "email");
    }
    if (code === "auth/phone-number-already-exists") {
      throw new ProvisioningError(
        "already-exists",
        "Phone number is already registered.",
        "phoneNumber",
      );
    }
    if (code === "auth/invalid-phone-number") {
      throw new ProvisioningError(
        "invalid-argument", "Phone number is invalid.", "phoneNumber");
    }
    if (code === "auth/invalid-email") {
      throw new ProvisioningError(
        "invalid-argument", "Email is invalid.", "email");
    }
    if (code === "auth/invalid-password") {
      throw new ProvisioningError(
        "invalid-argument", "Password is invalid.", "password");
    }
    throw new ProvisioningError(
      "internal",
      `Failed to create auth user: ${(err as Error)?.message ?? "unknown"}`,
    );
  }

  // From here on, any failure must roll back the Auth user.
  try {
    await auth().setCustomUserClaims(uid, {
      role: "user",
      surveyId: input.surveyId,
    });

    await db.runTransaction(async (tx) => {
      const [freshSurvey, freshUsername] = await Promise.all([
        tx.get(surveyRef),
        tx.get(usernameRef),
      ]);
      if (!freshSurvey.exists) {
        throw new ProvisioningError(
          "failed-precondition",
          "Survey vanished during creation.",
          "surveyId");
      }
      const data = freshSurvey.data() ?? {};
      if (data.status === 4) {
        throw new ProvisioningError(
          "failed-precondition", "Survey is already completed.", "surveyId");
      }
      if (typeof data.assignedUid === "string" && data.assignedUid) {
        throw new ProvisioningError(
          "failed-precondition",
          "Survey already has an assigned user.",
          "surveyId",
        );
      }
      if (freshUsername.exists) {
        throw new ProvisioningError(
          "already-exists", "Username is already taken.", "username");
      }

      tx.set(db.collection("users").doc(uid), {
        role: "user",
        username: input.username,
        email: input.email,
        phoneNumber: input.phoneNumber,
        name: input.name,
        surveyId: input.surveyId,
        isActive: true,
        createdBy: input.callerUid,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(usernameRef, {
        uid,
        surveyId: input.surveyId,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(surveyRef, {
        assignedUid: uid,
        assignedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    });

    return {uid, username: input.username};
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
    // Compensating delete is best-effort; surface original error.
  }
}
