# Universal Creative Thought Pipeline

The Universal Creative Thought Pipeline is Adam's core cognitive framework for all non-trivial creative tasks. It ensures that every request—whether it's a song, a blog post, art, or code—is handled with the same level of depth, reflection, and iterative improvement.

## The 8-Step Lifecycle

Strictly enforced by the `CreativeEngine`, the pipeline consists of eight distinct stages:

### 1. INTENT — Objective Definition
The system explicitly defines what it aims to achieve. This can be triggered by user commands, internal boredom levels, or "inspiration spikes" from memory.
- **Output**: A structured goal containing the medium, emotional target, and constraints.

### 2. IDEATION — Multi-Directional Exploration
Rather than jumping to the first solution, the system generates three distinct creative directions.
- **Heuristic**: The "winner" is selected based on a combination of **Novelty Score** and **Alignment with Drives**.

### 3. OUTLINE / PLAN — Structural Decomposition
The chosen idea is broken down into a structured plan relative to its medium.
- **Example**: Verses/Chorus for songs, Intro/Problem/Solution for blogs, or Class/Module structures for code.

### 4. DRAFT — Initial Implementation
The first functional or creative output is generated. The focus here is on completeness over perfection, providing a baseline for the critique loop.

### 5. SELF CRITIQUE — Multi-Persona Review
The draft is evaluated by three specialized psychological personas:
- **Creator**: Was the original intent and emotion landed?
- **Audience**: Is this engaging and likable?
- **Critic**: Are there technical flaws, repetition, or structural issues?

### 6. REVISION LOOP — Iterative Refinement
The system enters a `while` loop, refining the draft based on the combined feedback from the critique stage. 

### 7. SATISFACTION CHECK — Weighted Scoring
Final quality is calculated using a weighted formula:
`Quality = (Creator * 0.4) + (Audience * 0.4) + (Critic * 0.2)`
Execution only proceeds to the final step once this score exceeds the **Dynamic Satisfaction Threshold**.

### 8. ACCOMPLISHMENT + MEMORY — Persistent Storage
Metatada about the final artifact (theme, quality, style) is stored in the agent's long-term memory. This influences future ideation and ensures the agent "develops" over time.

---

## Technical Implementation

- **Medium Agnostic**: The pipeline routes to specialized generators based on the `medium` defined in the Intent stage.
- **Dynamic Thresholds**: The satisfaction threshold is not fixed; it is influenced by the agent's internal state (Perfectionism raises it, while Boredom lowers it).
- **Project Continuation**: At the start of a cycle, the system checks for `unfinished_projects` in memory, allowing for long-term project development across multiple sessions.
