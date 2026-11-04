import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'backend/data/', 'backend/backups/'] },
  js.configs.recommended,
  {
    // Frontend (browser, React); src/surplus, src/providers, src/routing and src/sync are pure Node-compatible logic, linted below
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/surplus/**', 'src/providers/**/*.js', 'src/routing/**/*.js', 'src/sync/**/*.js'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Frontend tests and Node-run modules
    files: ['src/**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Pure surplus domain logic (no browser globals) and local runner CLI (Node)
    files: ['src/surplus/**/*.js', 'src/providers/**/*.js', 'src/routing/**/*.js', 'src/sync/**/*.js', 'runner/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Backend + tooling (Node)
    files: ['backend/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
