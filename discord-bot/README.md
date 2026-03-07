# Discord Bot

A basic Discord bot built with Node.js and discord.js (v14).

## Setup
1. **Install Dependencies**: Run `npm install` to install the required packages.
2. **Configure Bot**: Edit `config.json` with your bot token, client ID, and guild ID.
   - You can get your bot token and client ID from the [Discord Developer Portal](https://discord.com/developers/applications).
   - Guild ID can be obtained by enabling Developer Mode in Discord and right-clicking your server.
3. **Run the Bot**: Use `npm start` to launch the bot.

## Commands
- `/ping` - Replies with 'Pong!'

## Adding More Commands
1. Create a new file in the `src/commands` directory.
2. Follow the structure of `ping.js` to define the command name, description, and execution logic.

## Requirements
- Node.js v16 or higher

## License
ISC
