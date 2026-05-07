# Delight Survey — Firebase Backend

## Commands

```bash
cd functions
npm install
npm run build          # Compile TypeScript → lib/
npm run build:watch    # Watch mode
npm run lint           # ESLint
npm run serve          # Build + start emulators (functions only)
npm run deploy         # Deploy functions (runs lint+build via predeploy)
npm run logs           # Tail Cloud Functions logs
```

Deploy rules only:
- Firestore: `firebase deploy --only firestore:rules`
- Storage:   `firebase deploy --only storage`
- Both:      `firebase deploy --only firestore:rules,storage`

## Architecture

```
.
├── firebase.json          # Functions + Firestore + Storage config
├── firestore.rules        # SINGLE source of truth — security rules
├── firestore.indexes.json
├── storage.rules          # SINGLE source of truth — Storage rules
└── functions/
    └── src/
        ├── index.ts                  # Entry point — sets global options, inits Firebase
        ├── config/firebase.ts        # firebase-admin singleton
        └── modules/
            ├── auth/                 # createSurveyUserAccount + resolveUsername callables
            ├── online-survey/        # Customer credential issue/revoke + completion trigger
            └── media/                # Gemini video item detection callable
```

This repo owns **all** Firebase configuration for the project. The
Flutter repos (`delight_survey`, `ai_survey`) keep only their own
`firebase.json` with the `flutter` platforms block — they no longer
duplicate `firestore.rules` or `storage.rules`. Edit and deploy from
here.

**Module convention:** Each feature gets a folder under `modules/` with `<name>.module.ts` (barrel export), `controller/` (function handlers), and `services/` (logic). Export the module from `index.ts`.

## Firestore

- **Project:** `delight-survey-f17b1` (region: `me-central1`)
- **Roles:** `admin` (full access), `manager` (read all + write masters + manage surveys), `surveyor` (own surveys + read masters)
- **Role source:** `users/{uid}.role` field; rules check `isActive` flag
- **Key collections:** surveys (with subcollections: addresses, checklists, items, photos, quotations, etc.), enquiries, customers, quotations
- **Master data (~20 collections):** articles, goods_types, vehicle_types, room_types, packing_types, rate_cards, checklist_master(s), costing_items, costing_profiles, etc.
- **Gotcha:** Some collections have dual names (`checklist_master` / `checklist_masters`, `costing_items` / `costing_profiles`) — rules cover both

## Environment

- Node 24, TypeScript (strict), target ES2017
- firebase-functions v7, firebase-admin v13
- `.env` is gitignored — used for local secrets (nodemailer config, etc.)
- Predeploy hooks run lint + build automatically

## Gotchas

- `firebase.ts` uses lazy getters (`firestore()`, `auth()`) — call them as functions, not properties
- Module barrel files export `{}` when empty — add named exports as you add controllers
- Firestore rules do an extra `get()` read for survey subcollection access (costs 1 billable read per eval)
- Both `checklist_master` and `checklist_masters` collection names exist in rules — keep in sync with client code
