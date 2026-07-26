import assert from "node:assert/strict";
import test from "node:test";
import { selectModel } from "../../../src/features/chats/modelSelection";
test("uses requested, then Agent, then Auto model precedence with provenance", () => { assert.deepEqual(selectModel("requested", "agent", "auto"), { effectiveModelId: "requested", source: "requested" }); assert.deepEqual(selectModel(null, "agent", "auto"), { effectiveModelId: "agent", source: "agent" }); assert.deepEqual(selectModel(null, null, "auto"), { effectiveModelId: "auto", source: "auto" }); });
