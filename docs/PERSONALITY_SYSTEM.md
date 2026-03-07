# Personality System: Drives & Memory

The Personality System is the engine of "creative tension" within Adam. It governs the agent's internal state, determines its standard for quality, and manages the long-term memory of its creative output.

## Creative Tension

Unlike static models, Adam is influenced by competing internal drives that shift based on effort and success:

-   **Perfectionism**: A drive that pushes for higher refinement. It increases the Satisfaction Threshold (`quality_threshold`), requiring more revision cycles before the agent accepts an artifact.
-   **Boredom**: A drive that accumulates as time passes or as the agent works on the same task for too long. High boredom lowers the quality threshold, prompting the agent to "wrap up" and move on to something new.
-   **Novelty Seeking**: Influences the Ideation stage by favoring ideas with higher novelty scores.
-   **Inspiration**: Boosted by successful accomplishments; it increases the agent's willingness to start complex new projects.

### Dynamic Threshold Calculation
The satisfaction threshold is calculated dynamically every turn:
`Standard = Base Threshold + (Perfectionism * 0.2) - (Boredom * 0.3)`

---

## Accomplishment Memory

The Personality System acts as the "Record Keeper" for the agent's life. 

### Step 8: Memory Integration
At the end of every 8-step pipeline cycle, the agent logs an **Accomplishment Entry** to `character_profile.json`:
-   **Artifact Type**: (e.g., song, code, blog)
-   **Theme & Style**: (e.g., "late night coding", "lofi melancholy")
-   **Quality Score**: The final satisfaction score achieved.
-   **Cycles**: How many revisions it took to reach completion.

### Memory Influence
Past accomplishments aren't just logs—they are fed back into the Intent and Ideation stages. If the agent has built several successful lofi songs, its "Inspiration" and "Novelty" drives will steer it toward reinforcing that theme or exploring a radical departure to curiosity spikes.

---

## Unfinished Projects

The system tracks projects that were started but not completed (cycles halted due to error or user interruption). 
-   **Continuity**: At the start of a new loop, the agent prioritizes "picking up where it left off" by resuming unfinished projects stored in memory, creating a sense of persistent, long-term work.
