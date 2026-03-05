import discord
from discord.ext import commands

# Create a bot instance
bot = commands.Bot(command_prefix='!')

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user}')

@bot.command()
async def hello(ctx):
    await ctx.send('Hello!')

# Run the bot with the token
bot.run('YOUR_BOT_TOKEN')