// Pulls jest-dom's matcher augmentation (`toBeInTheDocument`, `toHaveClass`, …) into this
// package's TypeScript program. `vitest.setup.ts` imports it at runtime, but that file sits
// outside `tsconfig.json`'s `include` (it would break `rootDir: src`), so the test files' use of
// those matchers needs this reference to type-check.
import "@testing-library/jest-dom/vitest";
