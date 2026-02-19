module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'bin',
    'examples/**/dist',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    'no-useless-catch': 'off',
    'no-constant-condition': 'off',
  },
  overrides: [
    {
      files: ['test/**/*.ts'],
      env: {
        node: true,
      },
    },
  ],
};

