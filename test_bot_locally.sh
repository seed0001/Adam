#!/bin/bash

# Script to test a bot locally
# This assumes the bot is a command-line application or has an API endpoint for testing

# Configuration
BOT_COMMAND="./mybot"  # Replace with your bot's command or path to executable
TEST_INPUT="Hello, bot!"  # Sample input to test the bot
EXPECTED_OUTPUT="Hello, user!"  # Expected response from the bot (adjust as needed)
LOG_FILE="bot_test.log"

# Function to log messages
function log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Start logging
log_message "Starting local bot test..."

# Test 1: Basic response test
log_message "Running Test 1: Basic response test"
echo "$TEST_INPUT" | $BOT_COMMAND > bot_output.txt
ACTUAL_OUTPUT=$(cat bot_output.txt)

if [[ "$ACTUAL_OUTPUT" == *"$EXPECTED_OUTPUT"* ]]; then
    log_message "Test 1 PASSED: Bot responded with expected output: $ACTUAL_OUTPUT"
    echo "Test 1 PASSED"
else
    log_message "Test 1 FAILED: Expected '$EXPECTED_OUTPUT', but got '$ACTUAL_OUTPUT'"
    echo "Test 1 FAILED"
fi

# Test 2: Check if bot is running (simple ping test)
log_message "Running Test 2: Bot availability test"
if $BOT_COMMAND --ping > /dev/null 2>&1; then
    log_message "Test 2 PASSED: Bot is running and responded to ping"
    echo "Test 2 PASSED"
else
    log_message "Test 2 FAILED: Bot did not respond to ping"
    echo "Test 2 FAILED"
fi

# Clean up
rm -f bot_output.txt
log_message "Test completed."

echo "Testing complete. Check $LOG_FILE for detailed results."
