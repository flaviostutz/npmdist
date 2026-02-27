// eslint-disable-next-line import/no-commonjs, functional/immutable-data
module.exports = {
  testMatch: ['**/?(*.)+(spec|test).+(ts|tsx|js)'],
  transform: {
    '^.+\\.(tsx?|json?)$': [
      'esbuild-jest',
      {
        sourcemap: true, // correct line numbers in code coverage
      },
    ],
  },
  coverageReporters: ['text'],
  collectCoverage: true,
  collectCoverageFrom: [
    './src/**',
    '!**/__tests__/**',
    '!./src/main.ts',
    '!./src/runner.ts',
    '!./src/index.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 80,
    },
  },
};
