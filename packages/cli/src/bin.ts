#!/usr/bin/env node
import { program } from "commander";
import { ADAM_VERSION } from "@adam/shared";
import { registerInitCommand } from "./commands/init.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerVoiceCommands } from "./commands/voice.js";
import { registerStatusCommands } from "./commands/status.js";

program
  .name("adam")
  .description("Adam — autonomous AI agent")
  .version(ADAM_VERSION);

registerInitCommand(program);
registerChatCommand(program);
registerVoiceCommands(program);
registerStatusCommands(program);

program
  .command("start")
  .description("Start the Adam daemon")
  .action(async () => {
    const { default: chalk } = await import("chalk");
    console.warn(chalk.cyan("Starting Adam daemon..."));
    console.warn(chalk.gray("Run from apps/daemon: pnpm dev"));
  });

program.parse(process.argv);
