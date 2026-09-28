# package-consumer

Installs the versioned pack from `pnpm pack --pack-destination .tmp/packages`
(`xylex-group-athena-<version>.tgz`, selected by `scripts/run-finality.mjs`)
and imports `@xylex-group/athena` from node_modules.
