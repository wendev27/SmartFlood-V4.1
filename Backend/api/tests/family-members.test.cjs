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
  FamilyMemberValidationError,
  buildFamilyCoveragePreview,
  persistStructuredHouseholdMembers,
  validateStructuredHouseholdMembers,
} = require('@/lib/familyMembers');
const { classifyCurrentAge, residentWithCurrentAge } = require('@/lib/dateUtils');

const familyId = '30000000-0000-4000-8000-000000000001';
const otherFamilyId = '30000000-0000-4000-8000-000000000002';
const applicationId = '40000000-0000-4000-8000-000000000001';
const memberId = '10000000-0000-4000-8000-000000000001';
const otherMemberId = '10000000-0000-4000-8000-000000000002';
const residentId = '20000000-0000-4000-8000-000000000001';

const validMember = (overrides = {}) => ({
  member_id: memberId,
  full_name: 'Ana Member',
  birth_date: '2000-01-01',
  resident_id: null,
  is_pwd: false,
  is_pregnant: false,
  pregnancy_weeks: null,
  is_lactating: false,
  is_4ps: false,
  ...overrides,
});

function fakeClient({ residents = [], members = [] } = {}) {
  const rows = {
    residents: residents.map(row => ({ ...row })),
    members: members.map(row => ({ ...row })),
  };

  const client = {
    rows,
    from(table) {
      const builder = {
        action: 'select',
        filters: [],
        upsertRows: [],
        select() { return builder; },
        in(column, values) { builder.filters.push({ column, values }); return builder; },
        upsert(values) { builder.action = 'upsert'; builder.upsertRows = values; return builder; },
        then(resolvePromise, rejectPromise) {
          Promise.resolve().then(() => {
            const source = table === 'residents_v3' ? rows.residents : rows.members;
            if (builder.action === 'upsert') {
              for (const value of builder.upsertRows) {
                const existingIndex = rows.members.findIndex(row => row.member_id === value.member_id);
                if (existingIndex >= 0) rows.members[existingIndex] = { ...rows.members[existingIndex], ...value };
                else rows.members.push({ ...value });
              }
              return { data: builder.upsertRows.map(value => ({ ...value })), error: null };
            }
            const filtered = source.filter(row => builder.filters.every(filter => filter.values.includes(row[filter.column])));
            return { data: filtered.map(row => ({ ...row })), error: null };
          }).then(resolvePromise, rejectPromise);
        },
      };
      return builder;
    },
  };
  return client;
}

function rejectsCode(callback, code) {
  assert.throws(callback, error => error instanceof FamilyMemberValidationError && error.code === code);
}

test('valid structured household members are normalized and nullable fields are accepted', () => {
  assert.deepEqual(validateStructuredHouseholdMembers([validMember({ birth_date: null })]), [{
    member_id: memberId,
    full_name: 'Ana Member',
    birth_date: null,
    resident_id: null,
    is_pwd: false,
    is_pregnant: false,
    pregnancy_weeks: null,
    is_lactating: false,
    is_4ps: false,
  }]);
});

test('vulnerability flags and pregnancy weeks are explicit and validated', () => {
  const [member] = validateStructuredHouseholdMembers([validMember({
    is_pwd: true,
    is_pregnant: true,
    pregnancy_weeks: 24,
    is_lactating: true,
    is_4ps: true,
  })]);
  assert.equal(member.is_pwd, true);
  assert.equal(member.pregnancy_weeks, 24);
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ is_pwd: 'yes' })]), 'invalid_vulnerability_flag');
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ pregnancy_weeks: 4 })]), 'invalid_pregnancy_weeks');
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ is_pregnant: true, pregnancy_weeks: 43 })]), 'invalid_pregnancy_weeks');
});

test('required names and UUID member identifiers are validated', () => {
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ full_name: '   ' })]), 'invalid_full_name');
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ member_id: 'not-a-uuid' })]), 'invalid_member_id');
  rejectsCode(() => validateStructuredHouseholdMembers([validMember(), validMember({ member_id: memberId.toUpperCase() })]), 'duplicate_member_id');
});

test('birth dates are calendar-valid and cannot be future dates', () => {
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ birth_date: '2026-02-30' })]), 'invalid_birth_date');
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ birth_date: '2099-01-01' })]), 'future_birth_date');
});

test('resident links are optional, UUID validated, and cannot repeat in one payload', () => {
  assert.equal(validateStructuredHouseholdMembers([validMember({ resident_id: residentId })])[0].resident_id, residentId);
  rejectsCode(() => validateStructuredHouseholdMembers([validMember({ resident_id: 'not-a-uuid' })]), 'invalid_resident_id');
  rejectsCode(() => validateStructuredHouseholdMembers([
    validMember({ resident_id: residentId }),
    validMember({ member_id: otherMemberId, resident_id: residentId }),
  ]), 'duplicate_resident_id');
});

test('persistence validates resident ownership and accepts an unlinked member', async () => {
  const client = fakeClient({ residents: [{ resident_id: residentId, family_id: familyId }] });
  const [row] = await persistStructuredHouseholdMembers({ client, applicationId, familyId, members: [validMember({ resident_id: residentId })] });
  assert.equal(row.family_id, familyId);
  assert.equal(row.source_application_id, applicationId);

  await persistStructuredHouseholdMembers({ client, applicationId, familyId, members: [validMember({ member_id: otherMemberId, resident_id: null })] });
  assert.equal(client.rows.members.length, 2);
});

test('persistence rejects missing residents and residents from another family', async () => {
  await assert.rejects(
    persistStructuredHouseholdMembers({ client: fakeClient(), applicationId, familyId, members: [validMember({ resident_id: residentId })] }),
    error => error.code === 'resident_not_found',
  );
  await assert.rejects(
    persistStructuredHouseholdMembers({ client: fakeClient({ residents: [{ resident_id: residentId, family_id: otherFamilyId }] }), applicationId, familyId, members: [validMember({ resident_id: residentId })] }),
    error => error.code === 'resident_family_mismatch',
  );
});

test('persistence rejects a resident link already owned by another member', async () => {
  await assert.rejects(
    persistStructuredHouseholdMembers({
      client: fakeClient({
        residents: [{ resident_id: residentId, family_id: familyId }],
        members: [{ member_id: otherMemberId, family_id: familyId, source_application_id: applicationId, resident_id: residentId }],
      }),
      applicationId,
      familyId,
      members: [validMember({ resident_id: residentId })],
    }),
    error => error.code === 'member_identity_conflict',
  );
});

test('stable member IDs make repeated persistence idempotent', async () => {
  const client = fakeClient();
  await persistStructuredHouseholdMembers({ client, applicationId, familyId, members: [validMember()] });
  await persistStructuredHouseholdMembers({ client, applicationId, familyId, members: [validMember()] });
  assert.equal(client.rows.members.length, 1);
});

test('same name and birth date remain valid for distinct member IDs', async () => {
  const client = fakeClient();
  await persistStructuredHouseholdMembers({ client, applicationId, familyId, members: [validMember(), validMember({ member_id: otherMemberId })] });
  assert.equal(client.rows.members.length, 2);
});

test('coverage distinguishes complete, missing rows, missing DOB, and no coverage', () => {
  const preview = buildFamilyCoveragePreview([
    { family_id: familyId, total_family_members: 2 },
    { family_id: otherFamilyId, total_family_members: 2 },
    { family_id: '30000000-0000-4000-8000-000000000003', total_family_members: 1 },
    { family_id: '30000000-0000-4000-8000-000000000004', total_family_members: 1 },
  ], [
    { resident_id: residentId, family_id: familyId },
    { resident_id: '20000000-0000-4000-8000-000000000002', family_id: otherFamilyId },
  ], [
    { member_id: memberId, family_id: familyId, birth_date: '2000-01-01' },
    { member_id: otherMemberId, family_id: familyId, birth_date: '2001-01-01' },
    { member_id: '10000000-0000-4000-8000-000000000003', family_id: otherFamilyId, birth_date: '2001-01-01' },
    { member_id: '10000000-0000-4000-8000-000000000004', family_id: '30000000-0000-4000-8000-000000000003', birth_date: null },
  ]);

  assert.equal(preview.families[0].coverage_complete, true);
  assert.deepEqual(preview.families[1].coverage_reasons, ['member_rows_missing']);
  assert.deepEqual(preview.families[2].coverage_reasons, ['birth_date_missing']);
  assert.deepEqual(preview.families[3].coverage_reasons, ['no_resident_or_member_coverage']);
  assert.equal(preview.summary.complete_family_count, 1);
  assert.equal(preview.summary.incomplete_family_count, 3);
});

test('existing stored family aggregates and resident age behavior are not transformed', () => {
  const family = { family_id: familyId, total_family_members: 6, infant_count: 2, toddler_count: 1, elderly_count: 3 };
  const preview = buildFamilyCoveragePreview([family], [], []);
  assert.deepEqual(family, { family_id: familyId, total_family_members: 6, infant_count: 2, toddler_count: 1, elderly_count: 3 });
  assert.equal(preview.families[0].stored_total_family_members, 6);

  const resident = residentWithCurrentAge({ birth_date: '2000-09-17', age: 25 }, new Date('2026-09-17T16:00:00.000Z'));
  assert.equal(resident.age, 26);
  assert.equal(resident.age_source, 'birth_date');
});

test('NULL DOB remains age-unavailable and approved classifier boundaries remain explicit', () => {
  const policy = { status: 'configured', thresholds: { infantMaxAge: 1, toddlerMaxAge: 3, elderlyMinAge: 60 } };
  assert.deepEqual(classifyCurrentAge(null, policy), { classification: 'unknown', age: null, reason: 'age_unavailable' });
  assert.equal(classifyCurrentAge(1, policy).classification, 'infant');
  assert.equal(classifyCurrentAge(2, policy).classification, 'toddler');
  assert.equal(classifyCurrentAge(3, policy).classification, 'toddler');
  assert.equal(classifyCurrentAge(60, policy).classification, 'elderly');
});
