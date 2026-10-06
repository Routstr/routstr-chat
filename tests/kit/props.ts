// fast-check settings shared by property tests. A failure prints its seed and path; replay it
// exactly with FC_SEED=<seed> FC_PATH=<path>. FC_RUNS=<n> runs more cases (a deep run).
import type { Parameters } from "fast-check";

export function fcParams<T>(defaults: Parameters<T> = {}): Parameters<T> {
  const env = process.env;
  return {
    ...defaults,
    ...(env.FC_SEED ? { seed: Number(env.FC_SEED), path: env.FC_PATH } : {}),
    ...(env.FC_RUNS ? { numRuns: Number(env.FC_RUNS) } : {}),
  };
}
