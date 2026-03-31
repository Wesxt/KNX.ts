import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    files: ["**/*.ts", "**/*.mts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "build/"],
  },
];
