# contributing

thanks for considering contributing to the athena-js. heres how to get started.

## development setup

```bash
# clone the repo
git clone https://github.com/xylex-group/athena-js
cd athena-js

# install dependencies
npm install

# build the package
npm run build

# run an example
cd examples/postgres-connection
npm install
npm start
```

## project structure

```
athena-js/
├── src/
│   ├── core/           # runtime and connector logic
│   ├── persistence/    # storage implementations
│   ├── strategies/     # retry, saga, failure handling
│   ├── telemetry/      # logging, metrics, heartbeat
│   ├── cli/            # command-line interface
│   ├── testing/        # test harness utilities
│   └── types/          # typescript type definitions
├── examples/           # example projects
└── docs/               # documentation
```

## coding style

we keep it casual but professional. some guidelines:

- **no emojis** in code or documentation
- **casual documentation** - write like youre explaining to a colleague, not writing a manual
- **clear naming** - prefer `runConnector` over `rc`
- **comments when needed** - explain why, not what
- **typescript strict mode** - all code must pass strict type checking

## writing documentation

documentation style should match the existing docs:

```markdown
## good example

connectors are async functions that can pause, call activities, and emit traces.
the runtime keeps them alive, retries them, and lets you attach telemetry so
databases stay predictable.
```

not this:

```markdown
## bad example

Connectors are complex helpers that wrap database calls. They provide logging,
retry, and heartbeat capabilities so that operations stay reliable.
```

keep it simple and conversational.

## testing

currently we dont have a full test suite (contributions welcome). when adding tests:

- use the test harness in `src/testing/`
- test critical paths
- test failure scenarios
- keep tests focused

## pull requests

1. fork the repo
2. create a feature branch (`git checkout -b feature/cool-thing`)
3. make your changes
4. test your changes (run examples, check types)
5. commit with clear messages
6. push and create a PR

## what to contribute

ideas for contributions:

- **more examples** - nextjs integration, data pipelines, etc
- **test coverage** - we need more tests
- **documentation** - tutorials, guides, api reference improvements
- **bug fixes** - always welcome
- **performance improvements** - profiling and optimization
- **new features** - discuss in an issue first

## feature requests

open an issue with:

- clear description of the feature
- use case / why its needed
- example of how it would be used

## bug reports

open an issue with:

- description of the bug
- steps to reproduce
- expected vs actual behavior
- environment (node version, os, etc)

## questions

open an issue or discussion. were happy to help.

## license

by contributing, you agree your contributions will be licensed under the MIT license.

## credits

athena-js is built by floris from XYLEX Group. contributors will be added to this list.

