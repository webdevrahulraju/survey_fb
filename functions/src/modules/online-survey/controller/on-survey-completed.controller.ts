import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {firestore, auth} from "../../../config/firebase";

// Survey status is an integer pushed by the Flutter client; mirror the
// AppConstants in delight_survey/lib/config/constants/app_constants.dart.
//   1 Pending, 2 Scheduled, 3 Synced, 4 Completed, 6 Lost, 9 Rejected.
const STATUS_COMPLETED = 4;

/**
 * Firestore trigger: when a survey's status changes to completed,
 * automatically disable the online customer's Firebase Auth account
 * AND deactivate their online_survey_users/{uid} profile so the
 * ai_survey LoginBloc rejects them at the profile-fetch step too.
 */
export const onSurveyCompleted = onDocumentUpdated(
  "surveys/{surveyId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    // Only act when status transitions to completed.
    if (before.status === after.status || after.status !== STATUS_COMPLETED) {
      return;
    }

    // Only act if online access was configured.
    if (!after.onlineAuth) return;

    // Already revoked — nothing to do.
    if (after.onlineAuth.isRevoked) return;

    const surveyId = event.params.surveyId;
    const uid = `online_survey_${surveyId}`;
    const db = firestore();
    const userRef = db.collection("online_survey_users").doc(uid);
    const surveyRef = db.collection("surveys").doc(surveyId);

    const batch = db.batch();
    batch.update(surveyRef, {"onlineAuth.isRevoked": true});
    batch.set(userRef, {isActive: false}, {merge: true});

    const username = typeof after.onlineAuth.username === "string" ?
      after.onlineAuth.username :
      null;
    if (username) {
      batch.delete(db.collection("usernames").doc(username));
    }
    await batch.commit();

    try {
      await auth().updateUser(uid, {disabled: true});
    } catch {
      // User may not exist if credentials/link were never used.
    }
  }
);
