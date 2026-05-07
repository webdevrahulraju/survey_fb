import {onCall, HttpsError} from "firebase-functions/v2/https";
import {storage} from "../../../config/firebase";
import {
  detectItemsFromStorage,
} from "../services/video-item-detection.service";

/**
 * Callable: detect household items from a video already uploaded to
 * Cloud Storage, using Firebase AI (Gemini, Google AI backend).
 *
 * Payload:
 *   { storagePath: string, bucket?: string }
 *
 * Returns:
 *   { success: true, items: DetectedItem[] }
 */
export const extractVideoDetails = onCall(
  {memory: "1GiB", timeoutSeconds: 540},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign-in required.");
    }

    const {storagePath, bucket} = request.data ?? {};
    if (typeof storagePath !== "string" || !storagePath.trim()) {
      throw new HttpsError(
        "invalid-argument",
        "storagePath (string) is required.",
      );
    }

    const cleanPath = storagePath
      .replace(/^gs:\/\/[^/]+\//, "")
      .replace(/^\/+/, "");
    const bucketName = typeof bucket === "string" && bucket.trim() ?
      bucket.trim() :
      storage().bucket().name;

    try {
      const items = await detectItemsFromStorage(bucketName, cleanPath);
      return {success: true, items};
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Detection failed.";
      if (message.startsWith("Object not found")) {
        throw new HttpsError("not-found", message);
      }
      throw new HttpsError(
        "internal",
        `Failed to detect items: ${message}`,
      );
    }
  },
);
