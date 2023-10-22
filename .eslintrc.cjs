/* eslint-env node */
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  rules: {
    // Possible Problems
    //'no-duplicate-imports': 'error',

    // Layout & Formatting
    'indent': ['error', 2],
    'no-trailing-spaces': 'error',
    'semi': ['error', 'always'],
    //'quotes': ['error', 'single', { 'avoidEscape': true, 'allowTemplateLiterals': true }],

    // Suggestions
    //'dot-notation': 'error',
    'eqeqeq': ['error', 'always'],
    'no-eval': 'error',
    'no-var': 'error'
  },
  ignorePatterns: [
    'dist/*'
  ],
  root: true,
};
