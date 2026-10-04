import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'dev-dist/**'],
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-alert': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'multi-line'],
      'no-implicit-globals': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'object-shorthand': ['error', 'properties'],
      'prefer-template': 'error',
      'no-else-return': 'error',
      'no-shadow': 'error',
      'no-param-reassign': ['error', { props: false }],
      'max-depth': ['warn', 4],
    },
  },
  {
    // O logger e o unico lugar autorizado a chamar console.debug/info.
    files: ['js/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
    rules: {
      'no-console': 'off',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];