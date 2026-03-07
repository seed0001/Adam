# Behavior Reinforcement & Performance Shaping

Adam is not a static agent. He evolves based on how you interact with him, using a guided evolution loop that combines manual feedback with autonomous behavior analysis.

---

## 1. Reinforcement Signals

The reinforcement system relies on "signals" to understand what behaviors are desirable.

### Feedback Type
Every piece of feedback submitted to the system includes a type:
- **Positive**: Reinforces the specific behavior and boosts associated traits.
- **Negative**: Signals a regression or undesirable approach; used to decrease trait scores.
- **Neutral / Idea**: Neutral observations or general ideas that don't directly impact scores but are stored for later review.

### Categories
Feedback is organized into categories to help Adam understand the *context* of the reinforcement:
- **Autonomy**: Creative problem solving and independent initiative.
- **Reliability**: Successful tool usage and error-free execution.
- **Communication**: Concise, helpful, and clear responses.
- **Architecture**: Design decisions and code organization.

---

## 2. Trait Tracking

Adam maintains a persistent "Scorecard" of his developing traits.

- **Persistent Scores**: Traits like **Initiative**, **Persistence**, and **Conciseness** have cumulative scores stored in the database.
- **Dynamic Shaping**: Positive feedback on a specific trait increases its score. High scores signal to Adam that these behaviors should be prioritized.
- **Emerging Strengths**: The **ReinforcementService** periodically analyzes these scores. If a trait is trending upward significantly, it is identified as an "Emerging Strength."

---

## 3. Propagation (Behavior Replication)

Reinforcement goes beyond just data points; it shapes future behavior through **Behavior Replication Proposals**.

1. **Analysis**: During the background Review Loop, Adam analyzes recent interactions that received positive feedback.
2. **Proposal**: If a specific successful behavior is detected (e.g., a particularly efficient way of refactoring code), Adam proposes a **Patch** to his own system instructions or logic to make that behavior a default.
3. **Approval**: Like all system patches, these must be reviewed and approved by you before they taking effect.

---

## 4. Golden Examples

A "Golden Example" is a benchmark interaction that represents the highest quality of system performance.

- **Curation**: When an interaction is flagged as "Golden" (manually or by AI detection), it is stored in a dedicated repository.
- **Technical Playbook**: These examples serve as a "Playbook" for the agent. When facing similar complex tasks in the future, Adam can refer to these Golden Examples to replicate the technical approach and communication style.
- **Searchable Benchmark**: Golden Examples are categorized (e.g., `golden:refactoring`, `golden:debugging`) for easy reference.

---

## 5. API Usage

Manual feedback can be submitted via the CLI or the Web Dashboard.

**Submit Feedback:**
`POST /api/feedback`
```json
{
  "type": "positive",
  "category": "Autonomy",
  "observation": "Adam independently suggested a more efficient schema migration path.",
  "trait": "Initiative",
  "impact": "high"
}
```

**List Traits:**
`GET /api/traits`
Returns the current scorecard of all tracked traits and their scores.

---

*Last updated: March 2026*
