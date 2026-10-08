// eslint.config.js — one purpose: make the react-hooks rules real. The
// `eslint-disable-next-line react-hooks/exhaustive-deps` comments in src/
// mark effects that deliberately omit deps; without a linter they were prose.
// Type-aware rules are not enabled (tsc --noEmit already covers types).
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "out/", "docs-site/", "src-tauri/", ".agents/", ".claude/", ".remember/"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,mjs}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Only the two classic rules. The v7 "recommended" set adds the React
      // Compiler rules (refs, immutability, set-state-in-effect); adopting
      // those is a later step, not part of turning the linter on.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // `_`-prefixed names are deliberate placeholders; tsc already enforces
      // types, so explicit `any` is left to review.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
