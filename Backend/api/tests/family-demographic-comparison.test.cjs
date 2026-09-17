const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.resolve(__dirname, '../src', request.slice(2)) : request, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

const {
  buildFamilyDemographicComparison,
} = require('@/lib/familyMembers');
const {
  APPROVED_DEMOGRAPHIC_AGE_POLICY,
  calculateCurrentAge,
  classifyCurrentAge,
} = require('@/lib/dateUtils');

const familyId = '30000000-0000-4000-8000-000000000001';
const secondFamilyId = '30000000-0000-4000-8000-000000000002';
const asOf = new Date('2026-09-17T04:00:00.000Z');

function member(memberId, birthDate) {
  return { member_id: memberId, family_id: familyId, birth_date: birthDate };
}

function compare(families, residents = [], members = []) {
  return buildFamilyDemographicComparison(families, residents, members, { asOf });
}

test('complete family receives dynamic counts and stored comparisons', () => {
  const result = compare([
    {
      family_id: familyId,
      total_family_members: 6,
      infant_count: 0,
      toddler_count: 1,
      elderly_count: 2,
    },
  ], [
    { resident_id: '20000000-0000-4000-8000-000000000001', family_id: familyId },
  ], [
    member('10000000-0000-4000-8000-000000000001', '2025-09-17'),
    member('10000000-0000-4000-8000-000000000002', '2025-09-16'),
    member('10000000-0000-4000-8000-000000000003', '2022-09-18'),
    member('10000000-0000-4000-8000-000000000004', '2022-09-17'),
    member('10000000-0000-4000-8000-000000000005', '1966-09-17'),
    member('10000000-0000-4000-8000-000000000006', '2000-09-17'),
  ]);

  const [row] = result.families;
  assert.equal(row.coverage_complete, true);
  assert.equal(row.dynamic_member_count, 6);
  assert.equal(row.dynamic_infant_count, 1);
  assert.equal(row.dynamic_toddler_count, 2);
  assert.equal(row.dynamic_elderly_count, 1);
  assert.equal(row.infant_difference, 1);
  assert.equal(row.toddler_difference, 1);
  assert.equal(row.elderly_difference, -1);
});

test('exactly 12 months is infant and 12 months plus one day is toddler', () => {
  const exactAge = calculateCurrentAge('2025-09-17', asOf);
  const nextDayAge = calculateCurrentAge('2025-09-16', asOf);

  assert.equal(classifyCurrentAge(exactAge, APPROVED_DEMOGRAPHIC_AGE_POLICY, {
    birthDate: '2025-09-17',
    asOf,
  }).classification, 'infant');
  assert.equal(classifyCurrentAge(nextDayAge, APPROVED_DEMOGRAPHIC_AGE_POLICY, {
    birthDate: '2025-09-16',
    asOf,
  }).classification, 'toddler');
});

test('under four years is toddler, four years is preschool, and 60 years is elderly', () => {
  const classify = (birthDate) => classifyCurrentAge(
    calculateCurrentAge(birthDate, asOf),
    APPROVED_DEMOGRAPHIC_AGE_POLICY,
    { birthDate, asOf },
  ).classification;

  assert.equal(classify('2022-09-18'), 'toddler');
  assert.equal(classify('2022-09-17'), 'preschool');
  assert.equal(classify('1966-09-17'), 'elderly');
});

test('missing member rows make the family incomplete and dynamic counts unavailable', () => {
  const [row] = compare([
    { family_id: familyId, total_family_members: 2, infant_count: 1, toddler_count: 0, elderly_count: 0 },
  ], [], [member('10000000-0000-4000-8000-000000000001', '2025-09-17')]).families;

  assert.equal(row.coverage_complete, false);
  assert.deepEqual(row.coverage_reasons, ['member_rows_missing']);
  assert.equal(row.dynamic_member_count, null);
  assert.equal(row.dynamic_infant_count, null);
  assert.equal(row.infant_difference, null);
});

test('missing DOB makes the family incomplete and never becomes dynamically classified', () => {
  const [row] = compare([
    { family_id: familyId, total_family_members: 1, infant_count: 1, toddler_count: 0, elderly_count: 0 },
  ], [], [member('10000000-0000-4000-8000-000000000001', null)]).families;

  assert.equal(row.coverage_complete, false);
  assert.deepEqual(row.coverage_reasons, ['birth_date_missing']);
  assert.equal(row.dob_unknown_family_member_count, 1);
  assert.equal(row.dynamic_infant_count, null);
});

test('resident rows exceeding the declared total make the family incomplete', () => {
  const [row] = compare([
    { family_id: familyId, total_family_members: 1, infant_count: 0, toddler_count: 0, elderly_count: 0 },
  ], [
    { resident_id: '20000000-0000-4000-8000-000000000001', family_id: familyId },
    { resident_id: '20000000-0000-4000-8000-000000000002', family_id: familyId },
  ], [member('10000000-0000-4000-8000-000000000001', '2000-01-01')]).families;

  assert.equal(row.coverage_complete, false);
  assert.deepEqual(row.coverage_reasons, ['resident_rows_exceed_declared_total']);
  assert.equal(row.dynamic_member_count, null);
  assert.equal(row.dynamic_elderly_count, null);
});

test('invalid declared totals make the family incomplete', () => {
  const [row] = compare([
    { family_id: familyId, total_family_members: 0, infant_count: 0, toddler_count: 0, elderly_count: 0 },
  ], [], []).families;

  assert.equal(row.coverage_complete, false);
  assert.deepEqual(row.coverage_reasons, ['declared_member_count_invalid', 'no_resident_or_member_coverage']);
  assert.equal(row.dynamic_member_count, null);
});

test('complete-only aggregate summary reports matches and differences', () => {
  const result = compare([
    { family_id: familyId, total_family_members: 1, infant_count: 1, toddler_count: 0, elderly_count: 0 },
    { family_id: secondFamilyId, total_family_members: 1, infant_count: 0, toddler_count: 0, elderly_count: 0 },
  ], [], [
    member('10000000-0000-4000-8000-000000000001', '2025-09-17'),
    { member_id: '10000000-0000-4000-8000-000000000002', family_id: secondFamilyId, birth_date: '2000-01-01' },
  ]);

  assert.equal(result.summary.family_count, 2);
  assert.equal(result.summary.complete_family_count, 2);
  assert.equal(result.summary.incomplete_family_count, 0);
  assert.equal(result.summary.authoritative_family_member_row_count, 2);
  assert.equal(result.summary.dob_known_family_member_count, 2);
  assert.equal(result.summary.dob_unknown_family_member_count, 0);
  assert.equal(result.summary.complete_stored_infant_total, 1);
  assert.equal(result.summary.complete_dynamic_infant_total, 1);
  assert.equal(result.summary.complete_infant_match_family_count, 2);
  assert.equal(result.summary.complete_infant_difference_family_count, 0);
  assert.equal(result.summary.complete_dynamic_toddler_total, 0);
  assert.equal(result.summary.complete_dynamic_elderly_total, 0);
});

test('stored aggregates are preserved and comparison performs no database writes', () => {
  const family = Object.freeze({
    family_id: familyId,
    total_family_members: 1,
    infant_count: 4,
    toddler_count: 3,
    elderly_count: 2,
  });
  const members = Object.freeze([Object.freeze(member('10000000-0000-4000-8000-000000000001', '2000-01-01'))]);
  const before = { ...family };

  const result = compare([family], [], members);

  assert.deepEqual(family, before);
  assert.equal(result.families[0].stored_infant_count, 4);
  assert.equal(result.families[0].dynamic_infant_count, 0);
  assert.equal(result.families[0].infant_difference, -4);
});

test('coverage summary identifies missing DOB, missing rows, and contradictory resident coverage', () => {
  const result = compare([
    { family_id: familyId, total_family_members: 1 },
    { family_id: secondFamilyId, total_family_members: 2 },
    { family_id: '30000000-0000-4000-8000-000000000003', total_family_members: 1 },
  ], [
    { resident_id: '20000000-0000-4000-8000-000000000001', family_id: familyId },
    { resident_id: '20000000-0000-4000-8000-000000000002', family_id: familyId },
  ], [
    member('10000000-0000-4000-8000-000000000001', null),
    { member_id: '10000000-0000-4000-8000-000000000002', family_id: secondFamilyId, birth_date: '2000-01-01' },
  ]);

  assert.equal(result.summary.families_with_missing_dob_count, 1);
  assert.equal(result.summary.families_with_missing_member_rows_count, 1);
  assert.equal(result.summary.families_with_contradictory_resident_coverage_count, 1);
  assert.equal(result.summary.dob_known_family_member_count, 1);
  assert.equal(result.summary.dob_unknown_family_member_count, 1);
});

test('coverage route keeps dashboard authorization and barangay scoping', () => {
  const route = fs.readFileSync(path.resolve(__dirname, '../src/app/api/family-members/coverage/route.ts'), 'utf8');

  assert.match(route, /getDashboardViewer\(req\)/);
  assert.match(route, /dashboardViewerRole\(viewer\)/);
  assert.match(route, /assignedBarangayForUser\(viewer\)/);
  assert.match(route, /eq\("barangay_id", scopedBarangayId\)/);
  assert.match(route, /REVIEW_ROLES/);
});
