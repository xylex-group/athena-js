"use strict";
module.exports = {
  env: {
    es2022: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist", "node_modules", "bin", "examples/**/dist"],
  overrides: [
    {
      env: {
        node: true,
      },
      files: ["test/**/*.ts"],
    },
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  root: true,
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-this-alias": "warn",
    "@typescript-eslint/no-unused-vars": "warn",
    "no-constant-condition": "warn",
    "no-useless-catch": "warn",
  },
};
