import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // This codebase routinely exports a shared constant/hook alongside a
      // component from the same file (MapView + LEG_STATUS_COLOR, auth.tsx's
      // AuthProvider + useAuth, ws.tsx's provider + useAlertWebSocket) — a
      // deliberate, idiomatic pattern here, not an oversight. The rule only
      // affects dev-time Fast Refresh ergonomics, not correctness, so it's
      // off rather than forcing a file-splitting refactor to satisfy it.
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Used deliberately in a few spots for untyped third-party APIs
      // (leaflet.heat has no type definitions) and generic catch blocks.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
