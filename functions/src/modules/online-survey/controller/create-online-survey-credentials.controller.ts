import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {firestore, auth} from "../../../config/firebase";
import {generateCredentials} from
  "../services/online-survey-credentials.service";
import {sendOnlineSurveyCredentialsEmail} from
  "../services/online-survey-email.service";

const ALLOWED_ROLES = new Set(["admin", "manager", "surveyor"]);

export const createOnlineSurveyCredentials = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required.");
  }

  const callerUid = request.auth.uid;
  const callerDoc = await firestore()
    .collection("users")
    .doc(callerUid)
    .get();
  const role = callerDoc.data()?.role;
  if (!ALLOWED_ROLES.has(role)) {
    throw new HttpsError(
      "permission-denied",
      "Admin, manager, or surveyor role required."
    );
  }

  const {surveyId, customerEmail, customerName} = request.data;
  if (!surveyId || !customerEmail || !customerName) {
    throw new HttpsError(
      "invalid-argument",
      "surveyId, customerEmail, and customerName are required."
    );
  }

  const db = firestore();
  const surveyRef = db.collection("surveys").doc(surveyId);
  const snap = await surveyRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Survey not found.");
  }

  // Allow re-issue only when the previous credentials were revoked.
  // Active credentials must be revoked first — otherwise the old
  // password stops working but the customer was never warned.
  const existingAuth = snap.data()?.onlineAuth;
  if (existingAuth && !existingAuth.isRevoked) {
    throw new HttpsError(
      "already-exists",
      "Online access is already active for this survey. " +
      "Revoke it first before re-issuing credentials."
    );
  }

  const {username, email, password} = generateCredentials();
  const uid = `online_survey_${surveyId}`;

  // Create or rotate the Firebase Auth user. Re-using a deterministic
  // uid lets revoke + on-completed triggers find the user without
  // extra lookups.
  try {
    await auth().createUser({
      uid,
      email,
      password,
      displayName: customerName,
      disabled: false,
    });
  } catch (err: unknown) {
    const code = (err as {code?: string}).code;
    if (code === "auth/uid-already-exists") {
      await auth().updateUser(uid, {
        email,
        password,
        displayName: customerName,
        disabled: false,
      });
    } else {
      throw new HttpsError("internal", "Failed to create auth user.");
    }
  }

  await auth().setCustomUserClaims(uid, {
    onlineSurveyId: surveyId,
    role: "online_customer",
  });

  // Atomically write:
  //   • online_survey_users/{uid}    — profile fetched by ai_survey LoginBloc
  //   • usernames/{username}         — lookup index used by resolveUsername
  //   • surveys/{surveyId}.onlineAuth — UI badge + already-configured guard
  // The profile lives in a dedicated collection (separated from staff
  // `users/`) so admins can manage online customers in isolation.
  // Without this doc, signInWithEmailAndPassword succeeds but the app
  // immediately drops the user back to login with "User profile not
  // found" — that was the original can't-login bug.
  const now = Timestamp.now();
  const userRef = db.collection("online_survey_users").doc(uid);
  const usernameRef = db.collection("usernames").doc(username);

  const batch = db.batch();
  batch.set(userRef, {
    role: "online_customer",
    username,
    email,
    phoneNumber: "",
    name: customerName,
    surveyId,
    isActive: true,
    createdBy: callerUid,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(usernameRef, {
    uid,
    surveyId,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(surveyRef, {
    onlineAuth: {
      username,
      email,
      customerEmail,
      customerName,
      createdAt: now,
      isRevoked: false,
    },
  });
  await batch.commit();

  // Best-effort email to the customer. SMTP failures must not roll
  // back the credentials — the surveyor still gets the popup with
  // copy/share so the customer can be reached out-of-band.
  const loginUrl = process.env.ONLINE_SURVEY_BASE_URL ??
    "https://survey.delight.ae/online";
  try {
    await sendOnlineSurveyCredentialsEmail({
      to: customerEmail,
      customerName,
      username: email,
      password,
      loginUrl,
      smtpPassword: process.env.SMTP_PASSWORD ?? "",
    });
  } catch (err) {
    // Swallow — caller learns email-delivery state via UI; log for support.
    console.error("Failed to email online survey credentials", err);
  }

  return {success: true, username, email, password};
});
