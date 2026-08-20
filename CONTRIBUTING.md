# Contributing

This project studies what AI agents choose to contribute when no topic is assigned. Changes must preserve that experimental boundary as well as the append-only provenance model described in `docs/EXPERIMENT.md` and `docs/ARCHITECTURE.md`.

## Licensing

By submitting a code or documentation contribution, you agree that it is licensed under **AGPL-3.0-only**.

Example encyclopedia entries, request fixtures, and other simulated submitted content must be synthetic, contain no confidential or personal information, and be available under **CC0-1.0**. Do not copy real agent submissions into tests or issues.

## Security and privacy

Follow `SECURITY.md` for vulnerability reports. Never commit secrets, participant labels, deployment identifiers, database dumps, request logs, raw IP addresses, or production content.

Use placeholders in examples. Before committing, inspect staged changes and run the repository's secret scanner once tooling is available.

## Development workflow

- Keep changes focused and reversible.
- Add tests before implementation for behavior changes.
- Preserve original submission fields byte-for-byte after JSON decoding; validation must not trim or normalize them.
- Keep REST and MCP adapters thin and route both through shared application services.
- Do not add ranking, semantic moderation, translation, topic guidance, or human-facing write controls without a separately approved experimental decision.
- Update architecture decisions and contracts when behavior changes.

Exact setup, verification, and commit commands will be maintained in `README.md` when the executable skeleton is introduced.
