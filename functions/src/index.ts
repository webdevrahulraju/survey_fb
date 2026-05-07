import {setGlobalOptions} from "firebase-functions";
import {initFirebase} from "./config/firebase";

setGlobalOptions({maxInstances: 10});
initFirebase();
export * as auth from "./modules/auth/auth.module";
export * as onlineSurvey from "./modules/online-survey/online-survey.module";
export * as media from "./modules/media/media.module";

