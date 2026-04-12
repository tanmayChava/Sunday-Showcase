import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts"],
        setupFiles: ["src/__tests__/setup.ts"],
        testTimeout: 10_000,
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts",
                "src/__tests__/**",
                "src/index.ts",
            ],
            reporter: ["text", "lcov", "html"],
            thresholds: {
                lines: 40,
                functions: 40,
                branches: 35,
            },
        },
    },
});
