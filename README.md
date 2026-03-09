# Adam

**A self-hosted autonomous AI agent that lives on your machine.**

Adam is not a chatbot. It is a persistent digital entity with layered memory, a structured reasoning loop, full tool access, a web dashboard, voice synthesis, and messaging adapters — running entirely on your hardware, under your control.

> For the full technical deep-dive see [`docs/README.md`](docs/README.md) and the [`docs/`](docs/) folder.

---

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 10

---

## Fresh install

```bash
git clone https://github.com/seed0001/Adam.git
cd Adam
pnpm install
pnpm build
```

Link the CLI globally:

```bash
cd packages/cli
pnpm link --global
cd ../..
```

Run the setup wizard (sets provider keys, adapters, budget):

```bash
adam init
```

Start chatting immediately — no daemon required:

```bash
adam chat
```

Or start the always-on daemon with the web dashboard:

```bash
adam start
```

Then open **http://localhost:18800** in your browser.

---

## Updating an existing install

If you already have Adam on your machine, pull the latest changes and rebuild:

```bash
# 1. Stop the daemon if it's running
adam stop

# 2. Pull the latest changes
git fetch origin
git checkout adam-speaks       # or whichever branch you want
git pull

# 3. Install any new dependencies
pnpm install

# 4. Rebuild all packages
pnpm build

# 5. Restart the daemon
adam start
```

> **Switching branches?** Always run `pnpm install && pnpm build` after a branch switch. Dependency and build output changes don't apply automatically.

---

## Voice setup (new on `adam-speaks`)

Adam now speaks. To enable it:

1. Start the daemon — `adam start`
2. Open the dashboard at **http://localhost:18800**
3. Go to the **Voices** tab
4. Click **Add voice**
5. Choose **Edge TTS** (no extra setup required — uses built-in Microsoft voices)
6. Pick a voice from the dropdown, give it a name, check **Set as default**, hit **Create**

That's it. Every response in Chat will now auto-play as audio. The player stays visible so you can replay it at any time.

**Want to use your own voice?** Choose **Lux TTS** instead and provide a path to a reference `.wav` file (minimum 3 seconds). Requires the Python sidecar — see [`packages/voice/sidecar/README.md`](packages/voice/sidecar/README.md).

---

## CLI commands

```
adam init              — Interactive setup wizard
adam chat              — Terminal chat session
adam start             — Start the background daemon
adam stop              — Stop the daemon
adam status            — Show daemon status, adapters, model pool, memory stats
adam voice             — Voice chat session (requires Lux TTS sidecar)
```

---

## Documentation

| Document | What's in it |
|---|---|
| [`docs/README.md`](docs/README.md) | Full project overview, all features, architecture |
| [`docs/OVERVIEW.md`](docs/OVERVIEW.md) | Technical deep-dive — packages, data flow |
| [`docs/AUTONOMOUS_MODE.md`](docs/AUTONOMOUS_MODE.md) | Autonomous tinkering mode design spec |
| [`docs/PROCESS_FLOW.md`](docs/PROCESS_FLOW.md) | Intent classification, planning, and execution flow |
| [`docs/SELF_REPAIR.md`](docs/SELF_REPAIR.md) | Failure Reflex Loop — automatic diagnosis and patching |
| [`docs/REINFORCEMENT.md`](docs/REINFORCEMENT.md) | Behavior shaping, trait tracking, Golden Examples |
| [`docs/BUILD_SUPERVISOR.md`](docs/BUILD_SUPERVISOR.md) | Background build pipeline |
| [`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md) | System diagnostics dashboard |

---

## License

MIT
