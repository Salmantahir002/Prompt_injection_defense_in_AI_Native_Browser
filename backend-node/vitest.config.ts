import { defineConfig } from 'vitest/config'

// Every route suite calls buildApp() (a full Fastify instance + pino logger).
// Running all suites in parallel worker threads pushed this environment's V8
// heap over the edge ("Committing semi space failed"), killing an unrelated
// sibling suite mid-run. A single fork keeps the whole run in one process —
// ~2.5s for the full suite, and deterministic.
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
