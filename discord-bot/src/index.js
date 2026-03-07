// index.js - Main entry point for the Discord bot

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { token } = require('../config.json');
const commandHandler = require('./handlers/commandHandler');

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Initialize command collection
client.commands = new Collection();

// Load commands
commandHandler.loadCommands(client);

// Event: Bot is ready
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// Event: Interaction create (for slash commands)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    }
});

// Login to Discord with your bot token
client.login(token);
