const METHOD_NAMES = new Map([
  ["get", "GET"],
  ["post", "POST"],
  ["put", "PUT"],
  ["delete", "DELETE"],
  ["patch", "PATCH"],
]);

function resolvePath(value, constants) {
  if (value.startsWith('"')) {
    return value.slice(1, -1);
  }
  return constants.get(value) ?? constants.get(value.split("::").at(-1));
}

export function collectRustRouteConstants(source, constants = new Map()) {
  const declaration =
    /\b(?:pub\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:\s*&str\s*=\s*"([^"]+)"\s*;/g;
  for (const match of source.matchAll(declaration)) {
    constants.set(match[1], match[2]);
  }
  for (const match of source.matchAll(
    /\b(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\s*\}/gm
  )) {
    for (const constant of match[2].matchAll(declaration)) {
      constants.set(`${match[1]}::${constant[1]}`, constant[2]);
    }
  }
  return constants;
}

export function scanRustRouteSource(
  source,
  file = "",
  constants = collectRustRouteConstants(source)
) {
  const routes = [];
  const add = (method, routePath, operation) => {
    if (!routePath || routePath.includes("{*")) {
      return;
    }
    routes.push({
      file,
      key: `${method} ${routePath}`,
      method,
      operation,
      path: routePath,
    });
  };

  for (const match of source.matchAll(
    /AuthRoute::(get|post|put|delete|patch)\s*\(\s*("[^"]+"|[A-Za-z_][A-Za-z0-9_:]*)(?:\s*,\s*"([^"]+)")?/g
  )) {
    const routePath = resolvePath(match[2], constants);
    add(METHOD_NAMES.get(match[1]), routePath, match[3] ?? routePath);
  }

  for (const match of source.matchAll(
    /\.route\s*\(\s*("[^"]+"|[A-Za-z_][A-Za-z0-9_:]*)\s*,\s*(?:[A-Za-z_][A-Za-z0-9_]*::)*(get|post|put|delete|patch)\s*\(/g
  )) {
    add(
      METHOD_NAMES.get(match[2]),
      resolvePath(match[1], constants)?.replace(
        /:([A-Za-z_][A-Za-z0-9_]*)/g,
        "{$1}"
      ),
      match[1]
    );
  }

  for (const match of source.matchAll(
    /\b(get|post|put|delete|patch)\s+"(\/[^"]+)"\s*=>\s*([A-Za-z_][A-Za-z0-9_]*)/g
  )) {
    add(METHOD_NAMES.get(match[1]), match[2], match[3]);
  }

  for (const match of source.matchAll(
    /\(\s*HttpMethod::(Get|Post|Put|Delete|Patch)\s*,\s*("[^"]+"|[A-Za-z_][A-Za-z0-9_:]*)\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,?\s*\)/g
  )) {
    add(match[1].toUpperCase(), resolvePath(match[2], constants), match[4]);
  }

  return routes;
}

export function duplicateRustRouteKeys(routes) {
  const seen = new Set();
  const duplicates = new Set();
  for (const { key } of routes) {
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }
  return [...duplicates].sort();
}
