# contributing

thanks for considering contributing to the worlds-engine. heres how to get started.

## development setup

```bash
# clone the repo
git clone https://github.com/xylex-group/worlds-engine
cd worlds-engine

# install dependencies
npm install

# build the package
npm run build

# run an example
cd examples/basic-workflow
npm install
npm start
```

## project structure

```
worlds-engine/
├── src/
│   ├── core/           # main workflow orchestration logic
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
- **clear naming** - prefer `processWorkflow` over `pw` or `processWf`
- **comments when needed** - explain why, not what
- **typescript strict mode** - all code must pass strict type checking

## writing documentation

documentation style should match the existing docs:

```markdown
## good example

workflows are just async functions that get special powers. they can sleep, run
activities, spawn children, whatever you need. the cool part is theyre durable
so they survive crashes.
```

not this:

```markdown
## bad example

Workflows are asynchronous functions that are provided with enhanced capabilities.
They have the ability to execute sleep operations, invoke activities, and spawn
child workflows. The most notable feature is their durability characteristic which
enables them to maintain state across process terminations.
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

worlds-engine is built by floris from XYLEX Group. contributors will be added to this list.

