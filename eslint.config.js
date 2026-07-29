import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["build", "dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "better-tailwindcss": betterTailwindcss,
    },
    settings: {
      "better-tailwindcss": {
        entryPoint: "src/index.css",
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // catches dead/unknown classes like the v3 `bg-opacity-50` that broke discography.
      // `ignore` allowlists the plain-CSS escape-hatch classes hand-authored in index.css
      // (see DESIGN.md) — the plugin only knows Tailwind's own utilities, not these.
      "better-tailwindcss/no-unknown-classes": [
        "error",
        {
          ignore: [
            "^animate-appear$",
            "^animate-appear-slow$",
            "^cursor-blink$",
            "^fx-scroll$",
            "^icon-pause$",
            "^icon-play$",
            "^play-spinner$",
            "^scrollbar-hide$",
            "^small$",
            "^tiny$",
            "^tbar-bg$",
          ],
        },
      ],
      "better-tailwindcss/no-deprecated-classes": "error",
      "better-tailwindcss/enforce-canonical-classes": "error",
    },
  }
);
