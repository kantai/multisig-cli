/* eslint-env node */
// TODO: Get rules requiring `parserOptions` working
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    //'plugin:@typescript-eslint/recommended-type-checked'
  ],
  parser: '@typescript-eslint/parser',
  /*
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  */
  plugins: ['@typescript-eslint'],
  rules: {
    // Possible Problems
    'no-duplicate-imports': 'warn',

    // Layout & Formatting
    'indent': ['warn', 2],
    'no-trailing-spaces': 'warn',
    'semi': ['warn', 'always'],
    //'quotes': ['error', 'single', { 'avoidEscape': true, 'allowTemplateLiterals': true }],

    // Suggestions
    //'dot-notation': 'error',
    'eqeqeq': ['error', 'always'],
    'no-eval': 'error',
    'no-var': 'error',

    // @typescript-eslint
    //'@typescript-eslint/prefer-nullish-coalescing': 'error',
    //'@typescript-eslint/prefer-readonly': 'error',
    //'@typescript-eslint/promise-function-async': 'error',

    // @typescript-eslint Extension Rules
    //'@typescript-eslint/dot-notation': 'error',
    //'@typescript-eslint/no-use-before-define': 'error',
  },
  ignorePatterns: [
    'dist/*'
  ],
  root: true,
};
