// Online Survey module — customer-facing auth for online surveys.
// Handlers: ./controller/*.controller.ts
// Logic:    ./services/*.service.ts

// Username/password credential flow
export {createOnlineSurveyCredentials} from
  "./controller/create-online-survey-credentials.controller";
export {revokeOnlineSurveyCredentials} from
  "./controller/revoke-online-survey-credentials.controller";

// Auto-disable on survey completion
export {onSurveyCompleted} from
  "./controller/on-survey-completed.controller";
