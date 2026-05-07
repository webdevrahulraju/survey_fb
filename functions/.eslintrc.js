module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*",
    "/generated/**/*",
  ],
  plugins: [
    "@typescript-eslint",
    "import",
    "check-file",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],

    // Module structure — enforce filename suffixes per folder.
    // New module: src/modules/<feature>/<feature>.module.ts,
    // handlers in controller/*.controller.ts,
    // logic in services/*.service.ts.
    // Rules apply uniformly to every module — no per-module config needed.
    "check-file/filename-naming-convention": [
      "error",
      {
        "src/modules/*/*.ts": "*.module",
        "src/modules/*/controller/**/*.ts": "*.controller",
        "src/modules/*/services/**/*.ts": "*.service",
      },
      {ignoreMiddleExtensions: false},
    ],

    // Module folder names must be kebab-case, and a module's only allowed
    // subfolders are "controller" and "services" (any other folder name fails).
    "check-file/folder-naming-convention": [
      "error",
      {
        // All folders under modules/ must be kebab-case. Single-word
        // names like "controller" and "services" pass kebab-case.
        // The filename-naming-convention above already restricts which
        // subfolders may contain .ts files (controller/, services/).
        "src/modules/**": "KEBAB_CASE",
      },
    ],
  },
};
