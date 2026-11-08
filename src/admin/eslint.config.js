// ESLint flat config for the admin UI.
//
// The only rules here are ui-components' own: no raw controls, no inline
// styles, no arbitrary values that re-spell a design token, an explicit
// Button variant, and (on page files) no hand-drawn separators. TypeScript
// correctness is `tsc`'s job (`npm run typecheck`), so no type-aware or
// stylistic rule sets are layered on top.
import tseslint from 'typescript-eslint';
import uiComponents from '@connorhoehn/ui-components/eslint-plugin';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'vendor/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
  },
  ...uiComponents.configs.recommended,
  {
    files: ['src/**/*.tsx'],
    plugins: { 'ui-components': uiComponents },
    rules: {
      // EventNode hands its per-node transport accent to the stylesheet as
      // the custom properties --tone/--tone-ring, picked at runtime from the
      // node's data. That is the one runtime-derived style in the app.
      'ui-components/no-inline-style': ['error', { allowFiles: ['**/components/topology/EventNode.tsx'] }],
    },
  },
];
