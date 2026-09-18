// eslint.config.js — one purpose: make the react-hooks rules real. The
// `eslint-disable-next-line react-hooks/exhaustive-deps` comments in src/
// mark effects that deliberately omit deps; without a linter they were prose.
// Type-aware rules are not enabled (tsc --noEmit already covers types).
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "out/", "docs-site/", "src-tauri/", ".agents/", "node_modules/"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,mjs}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // ponytail: only the two classic rules. The v7 "recommended" set adds the
      // React Compiler rules (refs, immutability, set-state-in-effect), which
      // flag ~35 sites in App.tsx that only the planned App.tsx split can fix.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // ponytail: tsc already enforces types; these three are the only
      // recommended rules the codebase trips on for stylistic reasons.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
