import {onCall, HttpsError} from "firebase-functions/v2/https";
import {Timestamp} from "firebase-admin/firestore";
import {firestore, auth} from "../../../config/firebase";
import {generateCredentials} from
  "../services/online-survey-credentials.service";
import {sendOnlineSurveyCredentialsEmail} from
  "../services/online-survey-email.service";

export const createOnlineSurveyCredentials = onCall(async (request) => {
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

  const {surveyId, customerEmail, customerName} = request.data;
  if (!surveyId || !customerEmail || !customerName) {
    throw new HttpsError(
      "invalid-argument",
      "surveyId, customerEmail, and customerName are required."
    );
  }

  const surveyRef = firestore().collection("surveys").doc(surveyId);
  const snap = await surveyRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Survey not found.");
  }

  if (snap.data()?.onlineAuth) {
    throw new HttpsError(
      "already-exists",
      "Online access is already configured for this survey. " +
      "Revoke it first before creating new credentials."
    );
  }

  const {username, email, password} = generateCredentials();

  // Create Firebase Auth user with email/password.
  const uid = `online_survey_${surveyId}`;
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
      // Re-use existing auth user — update credentials.
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

  // Store credential metadata (NOT the password) on the survey.
  const onlineAuth = {
    username,
    email,
    customerEmail,
    customerName,
    createdAt: Timestamp.now(),
    isRevoked: false,
  };
  await surveyRef.update({onlineAuth});

  // Email credentials to the customer.
  const loginUrl = process.env.ONLINE_SURVEY_BASE_URL ??
    "https://survey.delight.ae/online";

  await sendOnlineSurveyCredentialsEmail({
    to: customerEmail,
    customerName,
    username: email,
    password,
    loginUrl,
    smtpPassword: process.env.SMTP_PASSWORD ?? "",
  });

  return {success: true, username, email, password};
});
