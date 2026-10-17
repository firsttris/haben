import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import haben from "./eslint/modulgrenzen.js";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.output/**", "**/dist/**", "**/routeTree.gen.ts", "**/test-fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Modulgrenzen im Server, siehe eslint/modulgrenzen.js; Tests dürfen in andere Module greifen
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts"],
    plugins: { haben },
    rules: { "haben/modulgrenzen": "error" },
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
