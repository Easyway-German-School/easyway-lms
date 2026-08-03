import next from "eslint-config-next/core-web-vitals";

/**
 * Flat config, because ESLint 9 stopped reading `.eslintrc.*` and this project
 * had neither — so `npm run lint` had been failing instantly, and nothing had
 * been linted for some time. That is the gap this file closes.
 *
 * `eslint-config-next` 16 already ships a flat array, so there is no
 * `FlatCompat` shim here. It brings the react, react-hooks, import, jsx-a11y
 * and @next/next plugins, and ignores `.next/`, `out/`, `build/` and
 * `next-env.d.ts` on its own.
 *
 * The `core-web-vitals` entry point rather than the base one: it promotes
 * `no-html-link-for-pages` and `no-sync-scripts` from warning to error, both
 * of which are real problems on a phone over Nigerian mobile data.
 */
const config = [
  ...next,

  {
    /**
     * Nine `tmp_*.js` files sit in this directory — one-off Paystack patch and
     * inspection scripts from July, never committed and never intended to be.
     * Two of them do not even parse. They are ignored rather than deleted
     * because they are not ours to throw away, but they should not be able to
     * fail a lint run.
     */
    ignores: ["tmp_*.js"],
  },

  {
    linterOptions: {
      /**
       * OFF, which looks wrong and is not.
       *
       * ESLint reports a disable comment as unused when the rule it names is
       * not switched on. `eslint-config-next` registers the @typescript-eslint
       * plugin but enables *zero* of its rules, so every
       * `// eslint-disable-next-line @typescript-eslint/no-explicit-any` in the
       * codebase — and there are many — gets flagged as pointless.
       *
       * They are not pointless. They are correct annotations of deliberate
       * `any` usage, and they start working the moment anybody turns the
       * typed-lint rules on. Reporting them would invite somebody to strip
       * them all out, which quietly destroys that information.
       */
      reportUnusedDisableDirectives: "off",
    },

    rules: {
      /**
       * The React Compiler rule family, kept ON but demoted to warnings.
       *
       * `eslint-plugin-react-hooks` 7 ships the compiler's static analysis:
       * setState in an effect body, reading a ref during render, computing
       * impure values in render. They flagged 93 places here, and essentially
       * all of them are the same two patterns — fetch-on-mount into state, and
       * derive-during-render — which were idiomatic React when this app was
       * written and still work correctly today.
       *
       * Demoted rather than disabled, deliberately. Switching them off would
       * throw away a genuinely useful map of what needs modernising before the
       * React Compiler can be turned on; leaving them as errors would mean
       * `npm run lint` stays red until somebody does that refactor, which in
       * practice means nobody looks at lint output again. Warnings keep them
       * counted and visible without holding the build hostage to a rewrite
       * nobody has scheduled.
       *
       * `rules-of-hooks` and `exhaustive-deps` are NOT in this list — those
       * catch real bugs and stay at their defaults.
       */
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

// Named rather than `export default [...]`, which trips
// import/no-anonymous-default-export — a lint config that cannot lint itself
// cleanly is a bad advertisement for the rest of it.
export default config;
