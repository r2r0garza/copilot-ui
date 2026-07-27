import assert from "node:assert/strict";
import test from "node:test";
import { selectAvailableModel, selectModel } from "../../../src/features/chats/modelSelection";
test("uses requested, then Agent, then Auto model precedence with provenance", () => { assert.deepEqual(selectModel("requested", "agent", "auto"), { effectiveModelId: "requested", source: "requested" }); assert.deepEqual(selectModel(null, "agent", "auto"), { effectiveModelId: "agent", source: "agent" }); assert.deepEqual(selectModel(null, null, "auto"), { effectiveModelId: "auto", source: "auto" }); });

test("resolves only available models and never silently falls back from a preference", () => {
  const available = ["auto", "agent-b", "requested"];
  assert.deepEqual(selectAvailableModel("requested", ["agent-a", "agent-b"], available), { effectiveModelId: "requested", source: "requested" });
  assert.deepEqual(selectAvailableModel(null, ["agent-a", "agent-b"], available), { effectiveModelId: "agent-b", source: "agent" });
  assert.deepEqual(selectAvailableModel(null, null, available), { effectiveModelId: "auto", source: "auto" });
  assert.throws(() => selectAvailableModel("missing", "agent-b", available), /requested-model-unavailable/);
  assert.throws(() => selectAvailableModel(null, ["missing"], available), /agent-model-unavailable/);
  assert.throws(() => selectAvailableModel(null, null, []), /no-model-available/);
});
