# tool2agent [![documentation](https://img.shields.io/badge/API%20docs-blue)](https://tool2agent.org/docs/)

tool2agent is a protocol that enables LLM agents to navigate complex business constraints through trial and error by communicating rich and structured feedback data from tools.

Real-world domain constraints are complex, dynamic, and not publicly known — in other words, can't be fed into an LLM context. tool2agent defines rules for producing structured errors and suggestions that give an agent enough context to iteratively improve on its request until the goal is achieved.

Technically speaking, tool2agent is a set of conventions that allow structuring tool call feedback flows in a predictable manner. These conventions enable [novel tooling](https://github.com/tool2agent/tool2agent/tree/master/packages/ai) for agent builders.

![tool2agent response illustration](https://raw.githubusercontent.com/tool2agent/tool2agent/master/img/slide-1.png)

# Packages

## For agent developers

- [`@tool2agent/ai`](https://github.com/tool2agent/tool2agent/tree/master/packages/ai) — Bindings for AI SDK.

### Middleware for AI SDK

- [`@tool2agent/middleware-idempotency`](https://github.com/tool2agent/tool2agent/tree/master/packages/middleware-idempotency) - make a tool2agent tool idempotent (refuse execution with the same parameters more than once).

## For tool2agent tooling developers

- [`@tool2agent/types`](https://github.com/tool2agent/tool2agent/tree/master/packages/types) — TypeScript type definitions for the protocol that act as a specification.
- [`@tool2agent/schemas`](https://github.com/tool2agent/tool2agent/tree/master/packages/schemas) — Zod schema generators that map user-defined domain type schemas to tool2agent schemas that use these domain types.

# Motivation

## Handling domain constraints

Sometimes developers "leak" domain constraints into prompts to guide the model towards producing better tool call payloads, which bloats the context and erodes separation of concerns.

Domain constraints can be:

- dynamic (changing while the inference runs), so not suitable for inclusion in the system prompt
- too complex for the LLM to handle (e.g. derived from the state of the database)
- private (containing sensitive information that we can't feed to an LLM)

tool2agent encourages expressing domain constraints as guardrails on the code level and guiding the LLM flow using tool feedback.

## Tool schemas are not enough

Tool schemas alone are often not sufficient to convey enough information about expected input payloads.

A good feedback system combined with a very primitive schema may be better than a complex schema with precisely encoded variants, even though it requires more tool calls. This is especially true in contexts where there is no way to encode domain constraints in the schema or the system prompt.

## Tooling reuse requires effort

Although there are common LLM tool call validation patterns (beyond shared schemas), in a real application they may not be turned into reusable code, because that would require additional engineering efforts.

Structuring the way information flows from tools to an LLM allows for programmatic consumption of that data, e.g. in the form of reusable [middleware](https://github.com/tool2agent/tool2agent/blob/master/packages/ai/src/middleware.ts).

Additionally, tooling to _produce_ the feedback itself can be leveraged, an example of which is the [tool builder](https://github.com/tool2agent/tool2agent/blob/master/packages/ai/README.md#tool-builder) that integrates with AI SDK.

## Excessive token use

Precise tool schemas occupy a lot of input tokens.

In the context of agentic workflows, most tools will not be called, so there is no reason for the LLM to be aware of their precise schemas.

tool2agent-enabled workflows that use dynamic schemas may consume much fewer tokens (but require more tool calls for trial and feedback).

# Status

This project is an experiment that is a result of multiple LLM workflow design ideas converging together.
It remains to be seen what the limits of this approach are.

I invite you to try applying it to your problems. Let's invent new [middleware](https://github.com/tool2agent/tool2agent/blob/master/packages/ai/src/middleware.ts) and tool builder utilities. Here are some areas to look into:

- Observability, Logging
- Rate limiting, Debouncing, Tool call polling
- Automatic error fixup: using cheaper models to fix tool call problems on the fly
- Deriving tool feedback from app state
