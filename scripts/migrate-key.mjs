import { vault } from "../packages/security/dist/index.js";

const groqKey = await vault.get("provider:groq:api-key");

if (groqKey.isOk() && groqKey.value) {
  const xaiResult = await vault.set("provider:xai:api-key", groqKey.value);
  if (xaiResult.isOk()) {
    await vault.delete("provider:groq:api-key");
    console.log("Done — key moved from provider:groq:api-key to provider:xai:api-key");
  } else {
    console.error("Failed to write xAI key:", xaiResult.error.message);
    process.exit(1);
  }
} else {
  console.log("No key found under provider:groq:api-key. Nothing to migrate.");
}
