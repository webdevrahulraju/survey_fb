import {onCall, HttpsError} from "firebase-functions/v2/https";
import {firestore, auth} from "../../../config/firebase";

export const revokeOnlineSurveyCredentials = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }

  const callerDoc = await firestore()
    .collection("users")
    .doc(request.auth.uid)
    .get();
  const role = callerDoc.data()?.role;
  if (role !== "admin" && role !== "manager") {
    throw new HttpsError(
      "permission-denied",
      "Admin or manager role required."
    );
  }

  const {surveyId} = request.data;
  if (!surveyId) {
    throw new HttpsError(
      "invalid-argument",
      "surveyId is required."
    );
  }

  const surveyRef = firestore().collection("surveys").doc(surveyId);
  const snap = await surveyRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Survey not found.");
  }

  if (!snap.data()?.onlineAuth) {
    throw new HttpsError(
      "failed-precondition",
      "No online access configured."
    );
  }

  // Revoke in Firestore.
  await surveyRef.update({
    "onlineAuth.isRevoked": true,
  });

  // Disable Firebase Auth user.
  const uid = `online_survey_${surveyId}`;
  try {
    await auth().updateUser(uid, {disabled: true});
  } catch {
    // User may not exist if credentials were never used.
  }

  return {success: true};
});
