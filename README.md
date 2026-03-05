# Adam

**A self-hosted autonomous AI agent that lives on your machine.**

Adam is not a chatbot. It is a persistent digital entity with layered memory, full tool access, a structured reasoning loop, a web dashboard, and messaging adapters — running entirely on your hardware, under your control.

No cloud dependency by default. No subscription. No data leaving your machine unless you choose a cloud model provider.

---

## Quick start

```bash
git clone https://github.com/seed0001/Adam.git
cd Adam
pnpm install
pnpm build
cd packages/cli && pnpm link --global && cd ../..
adam init
adam start
```

Then open **http://localhost:18800** in your browser.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Full project documentation — features, quick start, CLI, providers, architecture |
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | Technical deep dive — packages, data flow, design decisions |
| [docs/BUILD_SUPERVISOR.md](docs/BUILD_SUPERVISOR.md) | BuildSupervisor — background build jobs, pipeline stages |
| [docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md) | System diagnostics dashboard — codebase analysis, pipeline tests |

---

## License

MIT
