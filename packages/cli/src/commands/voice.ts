import type { Command } from "commander";

export function registerVoiceCommands(program: Command): void {
  const voice = program
    .command("voice")
    .description("Manage voice profiles and the character sandbox");

  voice
    .command("list")
    .description("List all voice profiles")
    .action(async () => {
      const { default: chalk } = await import("chalk");
      const { VoiceRegistry } = await import("@adam/voice");
      const { getRawDatabase } = await import("@adam/memory");

      const db = getRawDatabase();
      const registry = new VoiceRegistry(db);
      const profiles = registry.list();

      if (profiles.length === 0) {
        console.warn(chalk.gray("No voice profiles found. Run: adam voice create"));
        return;
      }

      for (const p of profiles) {
        const tag = p.isDefault ? chalk.green(" [default]") : "";
        console.warn(`${chalk.bold(p.name)}${tag} — ${chalk.gray(p.id)}`);
        if (p.description) console.warn(`  ${p.description}`);
        if (p.persona) console.warn(`  ${chalk.italic(p.persona.slice(0, 80))}...`);
      }
    });

  voice
    .command("create")
    .description("Create a new voice profile")
    .action(async () => {
      const { default: inquirer } = await import("inquirer");
      const { default: chalk } = await import("chalk");
      const { VoiceRegistry } = await import("@adam/voice");
      const { getRawDatabase } = await import("@adam/memory");

      console.warn(chalk.cyan("\nCreating a new voice profile\n"));

      const answers = await inquirer.prompt([
        { type: "input", name: "name", message: "Voice name:", validate: (v: string) => v.length > 0 || "Name required" },
        { type: "input", name: "description", message: "Description (optional):", default: "" },
        { type: "input", name: "referenceAudioPath", message: "Path to reference audio file (WAV/MP3, min 3 seconds):", validate: (v: string) => v.length > 0 || "Reference audio required" },
        { type: "editor", name: "persona", message: "Character statement (how this voice speaks/behaves):", default: "Speak clearly and naturally." },
        { type: "confirm", name: "isDefault", message: "Set as default voice?", default: false },
      ]);

      const db = getRawDatabase();
      const registry = new VoiceRegistry(db);

      const result = registry.create({
        name: answers.name as string,
        description: answers.description as string,
        referenceAudioPath: answers.referenceAudioPath as string,
        persona: answers.persona as string,
        isDefault: answers.isDefault as boolean,
        params: {
          rms: 0.01,
          tShift: 0.9,
          numSteps: 4,
          speed: 1.0,
          returnSmooth: false,
          refDuration: 5,
        },
      });

      if (result.isErr()) {
        console.error(chalk.red(`Error: ${result.error.message}`));
        return;
      }

      console.warn(chalk.green(`\nVoice profile '${answers.name as string}' created (${result.value.id})`));
      console.warn(chalk.gray("Run: adam voice sandbox " + result.value.id));
    });

  voice
    .command("sandbox <voiceId>")
    .description("Interactive REPL — type text and hear it spoken immediately")
    .action(async (voiceId: string) => {
      const { default: chalk } = await import("chalk");
      const { default: readline } = await import("readline");
      const { VoiceRegistry, VoiceClient } = await import("@adam/voice");
      const { getRawDatabase } = await import("@adam/memory");
      const { join } = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      const db = getRawDatabase();
      const registry = new VoiceRegistry(db);
      const profile = registry.get(voiceId);

      if (!profile) {
        console.error(chalk.red(`Voice profile '${voiceId}' not found`));
        process.exit(1);
      }

      console.warn(chalk.cyan(`\nVoice Sandbox — ${chalk.bold(profile.name)}`));
      console.warn(chalk.gray(`Persona: ${profile.persona.slice(0, 100)}`));
      console.warn(chalk.gray("Type text and press Enter to synthesize. Ctrl+C to exit.\n"));

      const sidecarDir = join(
        fileURLToPath(import.meta.url),
        "../../../../voice/sidecar",
      );

      const client = new VoiceClient(sidecarDir);
      const startResult = await client.start();

      if (startResult.isErr()) {
        console.error(chalk.red(`Failed to start voice sidecar: ${startResult.error.message}`));
        process.exit(1);
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "text > " });
      rl.prompt();

      rl.on("line", async (line) => {
        const text = line.trim();
        if (!text) { rl.prompt(); return; }

        process.stdout.write(chalk.gray("Synthesizing..."));

        const result = await client.synthesize(
          { text, voiceProfileId: profile.id },
          profile,
        );

        if (result.isErr()) {
          console.warn(chalk.red(` Error: ${result.error.message}`));
        } else {
          console.warn(chalk.green(` Done (${result.value.durationMs}ms) → ${result.value.audioPath}`));

          const { exec } = await import("node:child_process");
          const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
          exec(`${opener} "${result.value.audioPath}"`);
        }

        rl.prompt();
      });

      rl.on("close", async () => {
        await client.stop();
        process.exit(0);
      });
    });

  voice
    .command("delete <voiceId>")
    .description("Delete a voice profile")
    .action(async (voiceId: string) => {
      const { default: chalk } = await import("chalk");
      const { default: inquirer } = await import("inquirer");
      const { VoiceRegistry } = await import("@adam/voice");
      const { getRawDatabase } = await import("@adam/memory");

      const db = getRawDatabase();
      const registry = new VoiceRegistry(db);
      const profile = registry.get(voiceId);

      if (!profile) {
        console.error(chalk.red(`Voice profile '${voiceId}' not found`));
        return;
      }

      const { confirm } = await inquirer.prompt([
        { type: "confirm", name: "confirm", message: `Delete '${profile.name}'?`, default: false },
      ]);

      if (confirm) {
        registry.delete(voiceId);
        console.warn(chalk.green("Deleted."));
      }
    });
}
