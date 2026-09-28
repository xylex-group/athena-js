/**
 * Packed-artifact probe loader: stub `server-only` only.
 * Do not remap `@xylex-group/athena` to `src/` — that would not test the tarball.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export {}",
    };
  }
  return nextResolve(specifier, context);
}
