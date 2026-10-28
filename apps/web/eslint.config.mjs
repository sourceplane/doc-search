// eslint-config-next 16 ships flat configs; the template's `.eslintrc.json`
// (`extends: next/core-web-vitals`, run through `next lint`) has no Next 16
// equivalent — `next lint` is gone — so this is what `create-next-app` writes
// for Next 16, and the `lint` script is `eslint .`.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The template's SearchDialog registers a keydown handler in an effect
      // that calls handleModalToggle, declared after it; this rule, new in
      // eslint-config-next 16, flags that, and the template is kept.
      "react-hooks/immutability": "off",
      // Upstream's lib/errors.ts types an error's extra data as
      // Record<string, any>, and lib/docs/process-mdx.ts (upstream's
      // generate-embeddings.ts) declares `type: 'markdown' = 'markdown'`;
      // both rules come with eslint-config-next 16's TypeScript config, which
      // upstream's ESLint 8 `next/core-web-vitals` did not include.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/prefer-as-const": "off",
      // components/ui/input.tsx declares the shadcn `InputProps extends
      // React.InputHTMLAttributes<HTMLInputElement> {}`; the rule comes with
      // eslint-config-next 16's TypeScript config and the template is kept.
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  globalIgnores([".next/**", ".open-next/**", "next-env.d.ts", "cloudflare-env.d.ts"]),
]);
