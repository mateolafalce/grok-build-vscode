# Muse Code adapter

`MuseBackend` starts `out/muse-adapter/main.mjs` with Node semantics and an explicitly located Muse executable. The adapter uses `@muse-code/sdk` 1.3.0 to run that executable as `muse serve`. Its NodeNext build is separate from the extension's CommonJS build. Diagnostics and child stderr never enter ACP stdout.

`ACP_PROVIDERS` and `isAcpProvider` retain the three legacy ids. `INTERNAL_PROVIDERS` includes Muse. Renderers expose Muse only after a host `providerState` advertises it, and guard outgoing provider messages as well. Availability comes from the execution host; native Windows is disabled. CLI discovery uses `grok.museCliPath`, `MUSE_CODE_EXECUTABLE`, PATH, then the user's local bin directory.

Sign-in uses the vendor's interactive CLI and `/login`. Check again connects the adapter after the user completes sign-in. MSP exposes no credential-status operation: a successful model catalog or history read is not proof of authentication. Actual credential failures remain visible through the normal conversation error path. The extension never accesses Muse's credential store.

The adapter requests no granted capabilities and declines user-input dialogs. It forwards text, tool calls and output, server-minted approval choices, cancellation, workspace-scoped session listing and explicit resume history. Model descriptions and the vendor's default selection are preserved. It does not offer steering, reasoning-effort controls, mode changes or deletion. Images, embedded resources and user-input dialogs remain unsupported.

A prompt waits for its matching terminal notification, not admission. Projection retains per-item emitted text across turns, suppresses duplicates and stale revisions, and logs prefix rewrites that ACP's append-only text channel cannot represent. Reminder items never contribute answer text. Approval presentation receipts are separate from decision commands; only offered choice ids may be sent.

Resume projects inline items or snapshot state explicitly, with paged durable revisions as the fallback. Incoming live events are buffered until history is projected. The host's shared history process starts in the home directory and is reused per provider. Path changes, failed starts and disconnects drain owned processes; the adapter awaits its SDK child before reporting `MUSE_CHILD_EXIT`.

Build and binary-free validation:

```sh
npm run compile
npx tsc -p . --noEmit
npm test
npm run check:vsix
```

The separate real-CLI proof runs on macOS or Linux after CLI sign-in:

```sh
node research/muse-acp-probe.cjs /absolute/path/to/muse /absolute/workspace
```

The probe also accepts `MUSE_CODE_EXECUTABLE` and `MUSE_PROBE_WORKSPACE`. It prints a new session, two checked answers in that session, and evidence of both process exits. It requires no TTY.
