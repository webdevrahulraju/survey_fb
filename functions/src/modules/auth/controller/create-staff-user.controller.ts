import {onCall, HttpsError} from "firebase-functions/v2/https";
import {firestore} from "../../../config/firebase";
import {
  provisionStaffUser,
  ProvisioningError,
  validateInput,
} from "../services/staff-provisioning.service";

/**
 * Callable: provision an internal staff user (admin / manager / surveyor).
 * Caller must be an active admin. Creates a Firebase Auth account,
 * sets the `role` custom claim, and writes `users/{uid}` with the same
 * shape as `UserModel.toMap()` on the Flutter client.
 *
 * Payload:
 *   { email, password, role, firstName, lastName, company,
 *     designation, mobile, countryCode }
 *
 * Returns:
 *   { success: true, uid, email, role }
 */
export const createStaffUser = onCall(
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
    if (!callerActive || callerRole !== "admin") {
      throw new HttpsError(
        "permission-denied",
        "Only an admin can create users.",
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
      const result = await provisionStaffUser({...validated, callerUid});
      return {
        success: true,
        uid: result.uid,
        email: result.email,
        role: result.role,
      };
    } catch (err) {
      if (err instanceof ProvisioningError) {
        throw new HttpsError(err.code, err.message, {field: err.field});
      }
      const message = err instanceof Error ? err.message : "Unknown error.";
      throw new HttpsError("internal", `Failed to create user: ${message}`);
    }
  },
);
