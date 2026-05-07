import {onCall, HttpsError} from "firebase-functions/v2/https";
import {firestore} from "../../../config/firebase";
import {
  createSurveyUser,
  ProvisioningError,
  validateInput,
} from "../services/user-provisioning.service";

/**
 * Callable: provision a survey-scoped user (role 'user') tied to one
 * surveyId. Caller must be admin or manager. The created user can sign
 * in with email + password; username is exposed to the user and
 * resolved via the `usernames/{username}` collection.
 *
 * Payload:
 *   { surveyId, username, password, email, phoneNumber, name }
 *
 * Returns:
 *   { success: true, uid: string, username: string }
 */
export const createSurveyUserAccount = onCall(
  {memory: "256MiB", timeoutSeconds: 60},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.");
    }
    const callerUid = request.auth.uid;

    const callerSnap = await firestore()
      .collection("users")
      .doc(callerUid)
      .get();
    const callerData = callerSnap.data() ?? {};
    const callerRole = callerData.role;
    const callerActive = callerData.isActive !== false;
    if (!callerActive ||
        (callerRole !== "admin" && callerRole !== "manager")) {
      throw new HttpsError(
        "permission-denied",
        "Only an admin or manager can create survey users.",
      );
    }

    let validated;
    try {
      validated = validateInput(request.data ?? {});
    } catch (err) {
      if (err instanceof ProvisioningError) {
        throw new HttpsError(err.code, err.message, {field: err.field});
      }
      throw new HttpsError("invalid-argument", "Invalid payload.");
    }

    try {
      const result = await createSurveyUser({...validated, callerUid});
      return {success: true, uid: result.uid, username: result.username};
    } catch (err) {
      if (err instanceof ProvisioningError) {
        throw new HttpsError(err.code, err.message, {field: err.field});
      }
      const message = err instanceof Error ? err.message : "Unknown error.";
      throw new HttpsError("internal", `Failed to create user: ${message}`);
    }
  },
);
