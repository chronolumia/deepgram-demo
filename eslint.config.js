import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Deliberately close to the recommended presets. The value here is catching real mistakes
// (floating promises, unused code, shadowed names) — not enforcing taste, which is what the
// CLAUDE.md conventions and review are for. eslint-config-prettier goes last so formatting
// rules never fight the formatter.
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "public/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        // scripts/ is intentionally outside tsconfig's include (it would force rootDir back
        // to "." and nest the build output), so it needs the default-project escape hatch to
        // be type-aware-lintable at all.
        projectService: { allowDefaultProject: ["scripts/*.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The bug class this repo actually hit: a promise nobody awaited, failing somewhere
      // no try/catch could see it.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // CLAUDE.md section 3: no `any` on public boundaries.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off", // the pipeline's run log is a feature, not debug output
    },
  },

  {
    // Tests stub globals and build partial fixtures on purpose.
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // node:test's test() returns a promise the runner collects itself; awaiting each call
      // is not how the API is used, so the rule only produces noise here.
      "@typescript-eslint/no-floating-promises": "off",
    },
  }
);
