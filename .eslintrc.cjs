module.exports = {
  root: true,
  env: {
    es2021: true
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script'
  },
  ignorePatterns: ['public/index.html', 'node_modules/'],
  overrides: [
    {
      files: ['main.js', 'lib/**/*.js'],
      env: { node: true }
    },
    {
      files: ['test/**/*.js'],
      env: { node: true }
    },
    {
      files: ['public/**/*.js'],
      env: { browser: true }
    }
  ],
  rules: {
    'no-console': 'off',
    'no-var': 'error',
    'prefer-const': ['error', { destructuring: 'all' }]
  }
};
