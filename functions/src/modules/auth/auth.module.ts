// Auth module — aggregates every trigger in this feature.
// Handlers: ./controller/*.controller.ts
// Logic:    ./services/*.service.ts
export {createSurveyUserAccount} from
  "./controller/create-survey-user.controller";
export {createStaffUser} from
  "./controller/create-staff-user.controller";
export {setStaffUserActive} from
  "./controller/set-staff-user-active.controller";
export {resolveUsername} from
  "./controller/resolve-username.controller";
