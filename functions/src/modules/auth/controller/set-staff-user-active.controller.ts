import {onCall, HttpsError} from "firebase-functions/v2/https";
import {auth, firestore} from "../../../config/firebase";

/**
 * Callable: enable or disable an internal staff user.
 *
 * Caller must be an active admin. Updates the Firebase Auth `disabled`
 * flag AND the Firestore `users/{uid}.isActive` field atomically (from
 * the client's perspective). When deactivating, also revokes refresh
 * tokens so any existing session is terminated immediately.
 *
 * Payload:
 *   { uid: string, isActive: boolean }
 *
 * Returns:
 *   { success: true, uid: string, isActive: boolean }
 */
export const setStaffUserActive = onCall(
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
        "Only an admin can change a user's active status.",
      );
    }

    const data = (request.data ?? {}) as {uid?: unknown; isActive?: unknown};
    const targetUid =
      typeof data.uid === "string" ? data.uid.trim() : "";
    const isActive = data.isActive;

    if (!targetUid) {
      throw new HttpsError(
        "invalid-argument", "uid is required.", {field: "uid"});
    }
    if (typeof isActive !== "boolean") {
      throw new HttpsError(
        "invalid-argument",
        "isActive must be a boolean.",
        {field: "isActive"},
      );
    }
    if (targetUid === callerUid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot change your own active status.",
        {field: "uid"},
      );
    }

    // Confirm the target is an existing staff user.
    const targetRef = firestore().collection("users").doc(targetUid);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
      throw new HttpsError(
        "not-found", "User does not exist.", {field: "uid"});
    }

    try {
      await auth().updateUser(targetUid, {disabled: !isActive});
      if (!isActive) {
        await auth().revokeRefreshTokens(targetUid);
      }
      await targetRef.update({isActive});
      return {success: true, uid: targetUid, isActive};
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      throw new HttpsError(
        "internal", `Failed to update user status: ${message}`);
    }
  },
);
