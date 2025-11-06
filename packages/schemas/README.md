# @tool2agent/schemas [![API docs](https://img.shields.io/badge/API%20docs-blue)](https://tool2agent.org/docs/)

Zod schema generators for the tool2agent protocol.

This package provides runtime schema generation functions that work with Zod.

The schemas align with `@tool2agent/types` precisely.

The spec (types) uses a lot of constraints that are easy to express as TS types, but explode in size when encoded as JSON schemas (e.g. `AtLeastOne`, `AtMostOne`). It is not recommended to use the generated schemas for validation in production - but the schemas are still useful when testing tooling implementations, e.g. in languages other than TypeScript.
