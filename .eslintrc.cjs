/* eslint-env node */
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    // Style
    'indent': ['error', 2],
    'no-trailing-spaces': 'error',
    'semi': ['error', 'always'],
    // Safety
    'no-var': 'error',
  },
  ignorePatterns: [
    'dist/*'
  ],
  root: true,
};
