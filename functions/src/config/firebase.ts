import * as admin from "firebase-admin";

let initialized = false;

/** Initialize firebase-admin once per process. Safe to call multiple times. */
export function initFirebase(): void {
  if (initialized) return;
  admin.initializeApp();
  initialized = true;
}

export const firestore = (): admin.firestore.Firestore => admin.firestore();
export const auth = (): admin.auth.Auth => admin.auth();
export const storage = (): admin.storage.Storage => admin.storage();
