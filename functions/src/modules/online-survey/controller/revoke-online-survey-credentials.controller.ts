import {onCall, HttpsError} from "firebase-functions/v2/https";
import {firestore, auth} from "../../../config/firebase";

const ALLOWED_ROLES = new Set(["admin", "manager", "surveyor"]);

export const revokeOnlineSurveyCredentials = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }

  const callerDoc = await firestore()
    .collection("users")
    .doc(request.auth.uid)
    .get();
  const role = callerDoc.data()?.role;
  if (!ALLOWED_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "Admin, manager, or surveyor role required."
    );
  }

  const {surveyId} = request.data;
  if (!surveyId) {
    throw new HttpsError(
      "invalid-argument",
      "surveyId is required."
    );
  }

  const db = firestore();
  const surveyRef = db.collection("surveys").doc(surveyId);
  const snap = await surveyRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Survey not found.");
  }

  const onlineAuth = snap.data()?.onlineAuth;
  if (!onlineAuth) {
    throw new HttpsError(
      "failed-precondition",
      "No online access configured."
    );
  }

  const uid = `online_survey_${surveyId}`;
  const userRef = db.collection("online_survey_users").doc(uid);

  // Disable in Firestore — both onlineAuth.isRevoked (for UI badge) and
  // online_survey_users/{uid}.isActive (gates LoginBloc.getUserById
  // which is what the ai_survey login uses to admit the customer).
  const batch = db.batch();
  batch.update(surveyRef, {"onlineAuth.isRevoked": true});
  batch.set(userRef, {isActive: false}, {merge: true});

  const username = typeof onlineAuth.username === "string" ?
    onlineAuth.username :
    null;
  if (username) {
    batch.delete(db.collection("usernames").doc(username));
  }
  await batch.commit();

  // Disable Firebase Auth user. Belt-and-suspenders: even if the
  // Firestore update raced an in-flight token refresh, signInWithEmail
  // will now reject.
  try {
    await auth().updateUser(uid, {disabled: true});
  } catch {
    // User may not exist if credentials were never used.
  }

  return {success: true};
});
