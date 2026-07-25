import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const specPath = resolve(root, "docs/MVP-SPEC.md");
const requirementsPath = resolve(root, "docs/manifests/requirements.json");
const verificationPath = resolve(root, "docs/manifests/verification.json");
const gatePath = resolve(root, "docs/manifests/specification-gate.json");
const sqliteContractPath = resolve(root, "docs/manifests/sqlite-contract.v1.json");
const lifecycleDecisionPath = resolve(root, ".wayfinder/issues/WF-019-define-lifecycle-transition-contracts.md");
const protocolDecisionPath = resolve(root, ".wayfinder/issues/WF-020-lock-workbench-protocol-contract.md");
const sqliteDecisionPath = resolve(root, ".wayfinder/issues/WF-021-lock-sqlite-schema-transaction-map.md");

const [
  spec, requirementManifest, verification, gate, sqliteContract,
  lifecycleDecision, protocolDecision, sqliteDecision
] = await Promise.all([
  readFile(specPath, "utf8"),
  readFile(requirementsPath, "utf8").then(JSON.parse),
  readFile(verificationPath, "utf8").then(JSON.parse),
  readFile(gatePath, "utf8").then(JSON.parse),
  readFile(sqliteContractPath, "utf8").then(JSON.parse),
  readFile(lifecycleDecisionPath, "utf8"),
  readFile(protocolDecisionPath, "utf8"),
  readFile(sqliteDecisionPath, "utf8")
]);

const errors = [];
const blockers = [];
const duplicateValues = (values) =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
const requireFields = (object, fields, label) => {
  for (const field of fields) {
    if (!(field in object) || object[field] === "" || object[field] == null) {
      errors.push(`${label} is missing ${field}`);
    }
  }
};

if (requirementManifest.specRevision !== verification.specRevision ||
    verification.specRevision !== gate.specRevision) {
  errors.push("manifest spec revisions disagree");
}
if (!spec.includes(`Canonical revision: \`${gate.specRevision}\``)) {
  errors.push("canonical spec revision disagrees with manifests");
}

const normativeDecisions = [
  ["WF-019", lifecycleDecision, "Lifecycle transition contract"],
  ["WF-020", protocolDecision, "Workbench Protocol contract"],
  ["WF-021", sqliteDecision, "Logical SQLite decision"]
];
for (const [id, decision, linkLabel] of normativeDecisions) {
  if (!/^status: closed$/m.test(decision)) errors.push(`${id} normative decision is not closed`);
  if (!/^## Resolution$/m.test(decision)) errors.push(`${id} normative decision has no resolution`);
  if (!spec.includes(`[${linkLabel}]`)) errors.push(`${id} normative annex is not linked from canonical spec`);
}

if (sqliteContract.contractId !== "bridgit.sqlite.logical/v1" ||
    sqliteContract.sourceDecision !== "WF-021") {
  errors.push("logical SQLite contract identity or owner is invalid");
}
const sqliteTableNames = sqliteContract.tables.map(({ name }) => name);
const sqliteIndexNames = sqliteContract.indexes.map(({ name }) => name);
for (const duplicate of duplicateValues(sqliteTableNames)) errors.push(`duplicate SQLite table ${duplicate}`);
for (const duplicate of duplicateValues(sqliteIndexNames)) errors.push(`duplicate SQLite index ${duplicate}`);
if (sqliteTableNames.length !== 59) errors.push(`logical SQLite contract has ${sqliteTableNames.length} tables, expected 59`);
if (sqliteIndexNames.length !== 26) errors.push(`logical SQLite contract has ${sqliteIndexNames.length} indexes, expected 26`);
for (const table of sqliteContract.tables) {
  requireFields(table, ["name", "owner", "columns", "constraints"], `SQLite table ${table.name ?? "unknown"}`);
  if (!Array.isArray(table.columns) || !table.columns.length) errors.push(`SQLite table ${table.name} has no columns`);
  if (!Array.isArray(table.constraints) || !table.constraints.length) errors.push(`SQLite table ${table.name} has no constraints`);
}
for (const index of sqliteContract.indexes) {
  requireFields(index, ["name", "on", "purpose"], `SQLite index ${index.name ?? "unknown"}`);
  const targetTable = index.on?.match(/^([a-z_]+)\(/)?.[1];
  if (!targetTable || !sqliteTableNames.includes(targetTable)) {
    errors.push(`${index.name} targets unknown SQLite table ${targetTable ?? "unknown"}`);
  }
}
const declaredReferences = [
  ...JSON.stringify(sqliteContract.tables).matchAll(/REFERENCES ([a-z_]+)/g)
].map((match) => match[1]);
for (const target of declaredReferences.filter((name) => !sqliteTableNames.includes(name))) {
  errors.push(`logical SQLite contract references unknown table ${target}`);
}

const protocolCommandSection = protocolDecision.slice(
  protocolDecision.indexOf("### Command catalog"),
  protocolDecision.indexOf("### Projection Event catalog")
);
const protocolQuerySection = protocolDecision.slice(
  protocolDecision.indexOf("### Query catalog"),
  protocolDecision.indexOf("### Command catalog")
);
const protocolQueries = [
  ...protocolQuerySection.matchAll(/^\| `([^`]+)`/gm)
].map((match) => match[1]);
const protocolCommands = [
  ...protocolCommandSection.matchAll(/^\| [^|]+ \| `([^`]+)`/gm)
].map((match) => match[1]);
const mappedCommands = Object.values(sqliteContract.commandMap).flat();
if (protocolQueries.length !== 22) errors.push(`Protocol annex has ${protocolQueries.length} queries, expected 22`);
if (!spec.includes(`${protocolQueries.length} query identities`)) {
  errors.push("canonical spec Protocol query count disagrees with annex");
}
if (protocolCommands.length !== 60) errors.push(`Protocol annex has ${protocolCommands.length} commands, expected 60`);
if (!spec.includes(`${protocolCommands.length}\ncommand identities`) &&
    !spec.includes(`${protocolCommands.length} command identities`)) {
  errors.push("canonical spec Protocol command count disagrees with annex");
}
for (const command of protocolCommands) {
  const count = mappedCommands.filter((candidate) => candidate === command).length;
  if (count !== 1) errors.push(`Protocol command ${command} occurs ${count} times in SQLite command map`);
}
for (const command of mappedCommands.filter((candidate) => !protocolCommands.includes(candidate))) {
  errors.push(`SQLite command map contains unknown Protocol command ${command}`);
}
for (const profile of Object.keys(sqliteContract.commandMap)) {
  if (!(profile in sqliteContract.transactionProfiles)) {
    errors.push(`SQLite command map uses unknown transaction profile ${profile}`);
  }
}

const manifestRequirementIds = requirementManifest.requirements.map(({ id }) => id);
const specRequirementIds = [...spec.matchAll(/^#### (NR-[A-Z]+-\d{3})$/gm)].map((match) => match[1]);
for (const duplicate of duplicateValues(manifestRequirementIds)) errors.push(`duplicate requirement ${duplicate}`);
for (const duplicate of duplicateValues(specRequirementIds)) errors.push(`duplicate spec requirement ${duplicate}`);
for (const id of manifestRequirementIds.filter((id) => !specRequirementIds.includes(id))) {
  errors.push(`manifest requirement ${id} is absent from canonical spec`);
}
for (const id of specRequirementIds.filter((id) => !manifestRequirementIds.includes(id))) {
  errors.push(`canonical requirement ${id} is absent from manifest`);
}

const invariantIds = new Set(requirementManifest.invariants);
const componentIds = new Set(requirementManifest.components);
for (const requirement of requirementManifest.requirements) {
  requireFields(requirement, ["id", "component", "invariants", "source"], requirement.id ?? "requirement");
  if (!componentIds.has(requirement.component)) errors.push(`${requirement.id} has unknown component ${requirement.component}`);
  if (!requirement.invariants.length) errors.push(`${requirement.id} has no invariant`);
  for (const invariant of requirement.invariants) {
    if (!invariantIds.has(invariant)) errors.push(`${requirement.id} has unknown invariant ${invariant}`);
  }
}

const checkIds = verification.checks.map(({ id }) => id);
for (const duplicate of duplicateValues(checkIds)) errors.push(`duplicate check ${duplicate}`);
const checkIdSet = new Set(checkIds);
const requirementIdSet = new Set(manifestRequirementIds);
const threatIdSet = new Set(verification.threatCases.map(({ id }) => id));
const requiredCheckFields = [
  "id", "layer", "profiles", "targets", "requirements", "threatCases",
  "setup", "fixtures", "stimulus", "oracle", "prohibitedOutcomes"
];
for (const check of verification.checks) {
  requireFields(check, requiredCheckFields, check.id ?? "check");
  if (!check.requirements.length) errors.push(`${check.id} has no requirements`);
  for (const id of check.requirements) {
    if (!requirementIdSet.has(id)) errors.push(`${check.id} links unknown requirement ${id}`);
  }
  for (const id of check.threatCases) {
    if (!threatIdSet.has(id)) errors.push(`${check.id} links unknown threat ${id}`);
  }
}

for (const id of manifestRequirementIds) {
  if (!verification.checks.some((check) => check.requirements.includes(id))) {
    errors.push(`orphan requirement ${id}`);
  }
}

const scenarios = verification.acceptanceScenarios;
const expectedScenarios = Array.from({ length: 14 }, (_, index) => `AS-${String(index + 1).padStart(2, "0")}`);
if (JSON.stringify(scenarios.map(({ id }) => id)) !== JSON.stringify(expectedScenarios)) {
  errors.push("acceptance scenarios must be exactly AS-01 through AS-14");
}
for (const scenario of scenarios) {
  requireFields(
    scenario,
    [
      "id", "check", "requirements", "fixtures", "initialState", "steps",
      "oracle", "prohibitedOutcomes", "cleanup", "evidence"
    ],
    scenario.id ?? "scenario"
  );
  for (const field of ["requirements", "fixtures", "steps", "oracle", "prohibitedOutcomes", "evidence"]) {
    if (!Array.isArray(scenario[field]) || !scenario[field].length) {
      errors.push(`${scenario.id} has no ${field}`);
    }
  }
  if (!checkIdSet.has(scenario.check)) errors.push(`${scenario.id} links unknown check ${scenario.check}`);
  const check = verification.checks.find(({ id }) => id === scenario.check);
  if (check && !check.profiles.includes("headless-scenario")) {
    errors.push(`${scenario.id} check ${scenario.check} lacks headless-scenario profile`);
  }
  for (const id of scenario.requirements) {
    if (!requirementIdSet.has(id)) errors.push(`${scenario.id} links unknown requirement ${id}`);
  }
}

for (const threat of verification.threatCases) {
  requireFields(
    threat,
    [
      "id", "status", "assets", "trustBoundaries", "attackerCapabilities",
      "abusePaths", "requiredControls", "controlRequirements",
      "acceptedResidualRisk", "negativeChecks"
    ],
    threat.id ?? "threat"
  );
  if (threat.status !== "complete") errors.push(`${threat.id} is not complete`);
  for (const field of [
    "assets", "trustBoundaries", "attackerCapabilities", "abusePaths",
    "requiredControls", "controlRequirements", "negativeChecks"
  ]) {
    if (!Array.isArray(threat[field]) || !threat[field].length) {
      errors.push(`${threat.id} has no ${field}`);
    }
  }
  if (!threat.controlRequirements.length || !threat.negativeChecks.length) {
    errors.push(`${threat.id} has an orphan control or negative-check obligation`);
  }
  for (const id of threat.controlRequirements) {
    if (!requirementIdSet.has(id)) errors.push(`${threat.id} links unknown requirement ${id}`);
  }
  for (const id of threat.negativeChecks) {
    if (!checkIdSet.has(id)) errors.push(`${threat.id} links unknown negative check ${id}`);
  }
}

for (const boundary of verification.durabilityBoundaries) {
  requireFields(
    boundary,
    ["id", "status", "point", "expectedRecovery", "faultCheck"],
    boundary.id ?? "durability boundary"
  );
  if (boundary.status !== "complete") errors.push(`${boundary.id} is not complete`);
  if (!checkIdSet.has(boundary.faultCheck)) errors.push(`${boundary.id} links unknown fault check ${boundary.faultCheck}`);
}

for (const target of verification.supportedTargets) {
  const packagedChecks = verification.checks.filter((check) => check.profiles.includes("packaged-vscode"));
  if (!packagedChecks.length || packagedChecks.some((check) => !check.targets.includes(target))) {
    errors.push(`packaged VS Code coverage is incomplete for ${target}`);
  }
}

const unresolvedIds = gate.unresolvedItems.map(({ id }) => id);
const blockerClassifications = new Set([
  "mechanical-spec-defect",
  "missing-factual-evidence",
  "unresolved-decision",
  "out-of-scope-implementation-work"
]);
const reviewedIds = gate.blockerReview.map(({ id }) => id);
if (JSON.stringify(reviewedIds) !== JSON.stringify(["GAP-001","GAP-002","GAP-003","GAP-004","GAP-005","GAP-006"])) {
  errors.push("blocker review must classify exactly GAP-001 through GAP-006");
}
for (const item of gate.blockerReview) {
  requireFields(item, ["id", "classification", "status", "reason"], item.id ?? "blocker review");
  if (!blockerClassifications.has(item.classification)) {
    errors.push(`${item.id} has unknown classification ${item.classification}`);
  }
  if (item.classification === "unresolved-decision" && !item.ticket) {
    errors.push(`${item.id} is an unresolved decision without a Wayfinder ticket`);
  }
  if (item.classification !== "unresolved-decision" && item.ticket) {
    errors.push(`${item.id} creates a ticket for work that requires no decision`);
  }
  if (gate.status === "accepted" && item.status !== "resolved" && item.status !== "fixed") {
    errors.push(`${item.id} is not resolved in an accepted specification`);
  }
}
if (JSON.stringify(unresolvedIds) !== JSON.stringify(requirementManifest.unresolvedGaps)) {
  errors.push("requirements and gate manifests disagree on unresolved gaps");
}
for (const id of unresolvedIds) {
  if (!new RegExp(`^### ${id} —`, "m").test(spec)) errors.push(`${id} is absent from canonical spec`);
  blockers.push(`${id}: ${gate.unresolvedItems.find((item) => item.id === id).summary}`);
}

if (/\b(?:TBD|TODO|FIXME|XXX)\b/.test(spec)) {
  errors.push("canonical spec contains an unresolved placeholder token");
}
if (gate.status === "accepted") {
  if (blockers.length || gate.acceptanceRecord == null) {
    errors.push("gate claims acceptance without zero blockers and an acceptance record");
  } else {
    requireFields(
      gate.acceptanceRecord,
      [
        "recordId", "acceptedRevision", "acceptedAt", "acceptedBy",
        "acceptanceBasis", "semanticReviewer", "implementationClaim"
      ],
      "Specification Acceptance Record"
    );
    if (gate.acceptanceRecord.acceptedRevision !== gate.specRevision) {
      errors.push("Specification Acceptance Record revision disagrees with gate");
    }
  }
  if (gate.machineValidation.expectedStatus !== "pass" ||
      gate.machineValidation.structuralErrors !== 0 ||
      gate.machineValidation.acceptanceBlockers !== 0) {
    errors.push("accepted gate machine-validation expectation is not a clean pass");
  }
}

console.log(`Specification revision: ${gate.specRevision}`);
console.log(`Canonical requirements: ${manifestRequirementIds.length}`);
console.log(`Mandatory verification checks: ${verification.checks.length}`);
console.log(`Acceptance scenarios: ${scenarios.length}`);
console.log(`Structural errors: ${errors.length}`);
for (const error of errors) console.error(`ERROR ${error}`);
console.log(`Acceptance blockers: ${blockers.length}`);
for (const blocker of blockers) console.log(`BLOCKER ${blocker}`);

if (errors.length) process.exit(2);
if (blockers.length) {
  console.log("Specification Acceptance Gate: BLOCKED");
  process.exit(1);
}
console.log("Specification Acceptance Gate: PASS");
