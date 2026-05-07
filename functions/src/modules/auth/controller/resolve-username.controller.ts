import {onCall, HttpsError} from "firebase-functions/v2/https";
import {firestore} from "../../../config/firebase";

/**
 * Callable: resolve a username to the email used for Firebase Auth
 * sign-in. Used by the client to translate a username + password +
 * surveyId form into an email + password call to
 * signInWithEmailAndPassword.
 *
 * Refuses to resolve if the user is inactive or their survey is
 * already completed — keeps "completed survey ⇒ no login" enforced
 * even before the auth attempt.
 *
 * Payload:
 *   { username: string, surveyId: string }
 *
 * Returns:
 *   { success: true, email: string }
 */
export const resolveUsername = onCall(
  {memory: "256MiB", timeoutSeconds: 30},
  async (request) => {
    const raw = request.data ?? {};
    const username = typeof raw.username === "string" ?
      raw.username.trim().toLowerCase() :
      "";
    const surveyId = typeof raw.surveyId === "string" ?
      raw.surveyId.trim() :
      "";

    if (!username || !surveyId) {
      throw new HttpsError(
        "invalid-argument",
        "username and surveyId are required.",
      );
    }

    const db = firestore();
    const usernameSnap = await db
      .collection("usernames")
      .doc(username)
      .get();
    if (!usernameSnap.exists) {
      throw new HttpsError("not-found", "Invalid credentials.");
    }
    const usernameData = usernameSnap.data() ?? {};
    const uid = usernameData.uid;
    if (typeof uid !== "string" || !uid) {
      throw new HttpsError("not-found", "Invalid credentials.");
    }
    if (usernameData.surveyId !== surveyId) {
      throw new HttpsError("not-found", "Invalid credentials.");
    }

    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Invalid credentials.");
    }
    const userData = userSnap.data() ?? {};
    if (userData.isActive === false) {
      throw new HttpsError("permission-denied", "Account is disabled.");
    }
    if (userData.surveyId !== surveyId) {
      throw new HttpsError("not-found", "Invalid credentials.");
    }

    const surveySnap = await db.collection("surveys").doc(surveyId).get();
    if (!surveySnap.exists) {
      throw new HttpsError("not-found", "Survey not found.");
    }
    const surveyData = surveySnap.data() ?? {};
    // Status is an integer (4 = Completed) per AppConstants in
    // delight_survey/lib/config/constants/app_constants.dart.
    if (surveyData.status === 4) {
      throw new HttpsError(
        "failed-precondition",
        "Survey is already completed.",
      );
    }

    const email = userData.email;
    if (typeof email !== "string" || !email) {
      throw new HttpsError("internal", "User record is missing email.");
    }

    return {success: true, email};
  },
);
