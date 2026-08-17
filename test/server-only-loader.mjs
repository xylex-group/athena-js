/**
 * Node test loader: replace `server-only` with an empty module.
 * Next.js bundlers empty this package on the server and error on the client;
 * the published package always throws under plain Node.
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
