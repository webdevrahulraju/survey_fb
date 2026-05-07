import {readFile, unlink} from "fs/promises";
import {randomUUID} from "crypto";
import {tmpdir} from "os";
import {join, basename} from "path";
import {initializeApp, getApp, FirebaseApp} from "firebase/app";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  Schema,
} from "firebase/ai";
import {storage} from "../../../config/firebase";

const FIREBASE_AI_APP_NAME = "firebase-ai";
const MAX_INLINE_BYTES = 19 * 1024 * 1024;
const MODEL_ID = "gemini-2.5-flash";

export interface DetectedItem {
  itemname: string;
  discription: string;
  qty: string;
  volume: string;
  weight: string;
}

interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  appId: string;
}

let cachedApp: FirebaseApp | null = null;

/**
 * Lazily initialize a named FirebaseApp dedicated to AI calls. Kept
 * separate from `firebase-admin` (which uses ADC) so the Web SDK
 * config doesn't collide with admin credentials.
 * @return {FirebaseApp} Cached app instance.
 */
function getFirebaseAiApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  const config = readWebConfig();
  try {
    cachedApp = getApp(FIREBASE_AI_APP_NAME);
  } catch {
    cachedApp = initializeApp(config, FIREBASE_AI_APP_NAME);
  }
  return cachedApp;
}

/**
 * Read Firebase Web SDK config from env. These must be set as
 * function env vars (e.g. via .env or `firebase functions:config:set`).
 * @return {FirebaseWebConfig} Web config object.
 */
function readWebConfig(): FirebaseWebConfig {
  const apiKey = process.env.FIREBASE_AI_API_KEY;
  const projectId = process.env.FIREBASE_AI_PROJECT_ID ??
    process.env.GCLOUD_PROJECT;
  const appId = process.env.FIREBASE_AI_APP_ID;
  if (!apiKey || !projectId || !appId) {
    throw new Error(
      "Missing Firebase AI config — set FIREBASE_AI_API_KEY, " +
      "FIREBASE_AI_PROJECT_ID, FIREBASE_AI_APP_ID in functions env.",
    );
  }
  return {apiKey, projectId, appId};
}

/**
 * Download a video from Cloud Storage to /tmp and run Gemini item
 * detection on it. Cleans up the temp file when done.
 * @param {string} bucketName - Storage bucket.
 * @param {string} objectPath - Object path inside the bucket.
 * @return {Promise<DetectedItem[]>} Detected items.
 */
export async function detectItemsFromStorage(
  bucketName: string,
  objectPath: string,
): Promise<DetectedItem[]> {
  const file = storage().bucket(bucketName).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`Object not found: gs://${bucketName}/${objectPath}`);
  }
  const [meta] = await file.getMetadata();
  const mimeType = typeof meta.contentType === "string" && meta.contentType ?
    meta.contentType :
    "video/mp4";

  const localPath = join(
    tmpdir(),
    `${randomUUID()}-${basename(objectPath)}`,
  );
  await file.download({destination: localPath});
  try {
    return await detectItemsFromLocalVideo(localPath, mimeType);
  } finally {
    await unlink(localPath).catch(() => undefined);
  }
}

/**
 * Run Gemini (via FirebaseAI.googleAI() — Firebase AI Logic with the
 * Google AI backend) on a local video file and return the detected
 * household items shaped for moving/relocation surveying.
 * @param {string} localPath - Path to the already-downloaded video.
 * @param {string} mimeType - Content type, e.g. "video/mp4".
 * @return {Promise<DetectedItem[]>} Detected items.
 */
export async function detectItemsFromLocalVideo(
  localPath: string,
  mimeType: string,
): Promise<DetectedItem[]> {
  const buffer = await readFile(localPath);
  if (buffer.byteLength > MAX_INLINE_BYTES) {
    throw new Error(
      `Video too large for inline AI request (${buffer.byteLength} bytes). ` +
      `Maximum supported is ${MAX_INLINE_BYTES} bytes — split or compress ` +
      "the video first.",
    );
  }
  const base64 = buffer.toString("base64");

  const ai = getAI(getFirebaseAiApp(), {backend: new GoogleAIBackend()});

  const itemsSchema = Schema.array({
    items: Schema.object({
      properties: {
        itemname: Schema.string(),
        discription: Schema.string(),
        qty: Schema.string(),
        volume: Schema.string(),
        weight: Schema.string(),
      },
    }),
  });

  const model = getGenerativeModel(ai, {
    model: MODEL_ID,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: itemsSchema,
    },
  });

  const prompt =
    "You are a moving and relocation surveyor. Watch this household " +
    "survey video and list every visible household item that would be " +
    "packed and transported during a move.\n\n" +
    "For each item return:\n" +
    "- itemname: short name (e.g. 'Sofa', 'Refrigerator', 'Dining Table').\n" +
    "- discription: brief description — color, material, size, condition.\n" +
    "- qty: quantity as a string (e.g. '1', '2', '4').\n" +
    "- volume: estimated volume in CBM as a string ending with ' CBM' " +
    "(e.g. '0.5 CBM', '1.2 CBM'). Use industry-standard volumes for " +
    "typical household goods if exact measurement is not visible.\n" +
    "- weight: estimated weight in KG as a string ending with ' KG' " +
    "(e.g. '25 KG', '120 KG'). Use industry-standard weights when " +
    "exact measurement is not visible.\n\n" +
    "Skip fixtures (built-in cabinets, doors, windows, lighting, AC " +
    "units) and trivial items below 0.01 CBM. Return ONLY the JSON " +
    "array — no surrounding prose.";

  const result = await model.generateContent([
    {inlineData: {data: base64, mimeType}},
    {text: prompt},
  ]);

  const text = result.response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `AI response was not valid JSON: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("AI response was not a JSON array.");
  }
  return parsed as DetectedItem[];
}
