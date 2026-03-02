#!/usr/bin/env node
import { program } from "commander";
import { ADAM_VERSION } from "@adam/shared";
import { registerInitCommand } from "./commands/init.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerVoiceCommands } from "./commands/voice.js";
import { registerStatusCommands } from "./commands/status.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStopCommand } from "./commands/stop.js";

program
  .name("adam")
  .description("Adam — autonomous AI agent")
  .version(ADAM_VERSION);

registerInitCommand(program);
registerChatCommand(program);
registerVoiceCommands(program);
registerStatusCommands(program);
registerStartCommand(program);
registerStopCommand(program);

program.parse(process.argv);
