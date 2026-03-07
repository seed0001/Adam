# Suno Publishing: Browser Automation Tool

The Suno Publishing tool enables Adam to autonomously create and publish musical artifacts by interacting directly with the Suno.com web interface.

## Architecture: Agent ↔ Daemon Flow

Unlike file-based tools, song publishing requires a persistent browser context (Playwright) and complex human-like interactions. To keep the creative engine lightweight, this logic is offloaded to the **Adam Daemon**:

1.  **Request**: The agent calls the `publish_to_suno(lyrics, style, title)` action.
2.  **Actuator**: `executor.py` sends an HTTP POST request to the daemon's `/api/tools/execute` endpoint.
3.  **Daemon**: The daemon retrieves the `publish_to_suno` tool, which utilizes the shared `BrowserSession`.
4.  **Automation**: The daemon automates the Suno "Custom Mode" flow:
    - Navigates to `suno.com/create`.
    - Toggles **"Custom Mode"**.
    - Clears and fills the **Lyrics**, **Style**, and **Title** textareas.
    - Clicks the **"Create"** or **"Generate"** button.
5.  **Response**: The daemon returns a success/failure result back to the actuator, which the agent then "observes".

---

## Technical Features

### Persistent Browser Session
The daemon maintains a single `BrowserSession` instance (defined in `browser.ts`). This allows:
-   **Session Reuse**: The agent stays logged into Suno across multiple creative cycles.
-   **Fast Execution**: No need to spin up a new browser for every song.
-   **Manual Recovery**: If the browser is closed manually, the `BrowserSession` detects the `close` event and automatically re-initializes the context on the next tool call.

### Resilient Selectors
The tool uses a multi-layered selection strategy to find UI elements on Suno.com:
1.  **Placeholder Search**: Initially searches for textareas containing labels like "Enter your lyrics".
2.  **Generic Fallback**: If specific labels change, it falls back to identifying textarea elements by their relative position or generic selectors.

---

## Usage in the Pipeline

The Suno tool is typically triggered in the **Revision** or **Finalization** stages of the Universal Pipeline. The agent is instructed to only call this tool once the lyrics have reached a "satisfactory" quality score.
