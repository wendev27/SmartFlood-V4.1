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
let rows, audits, sessionId, officer, loseRace;
const database = { from(table) {
  const filters = []; let patch;
  const query = {
    select() { return this; }, order() { return this; },
    eq(key, value) { filters.push(r => key === 'residents_v3.barangay_id' ? r.residents_v3.barangay_id === value : r[key] === value); return this; },
    is(key, value) { return this.eq(key, value); },
    in(key, values) { filters.push(r => values.includes(r[key])); return this; },
    update(value) { patch = value; return this; },
    execute(single) {
      const matches = (table === 'app_users' ? [officer] : rows).filter(r => r && filters.every(f => f(r)));
      if (patch && loseRace) return { data: null, error: null };
      if (patch) matches.forEach(r => Object.assign(r, patch));
      return { data: single ? structuredClone(matches[0] ?? null) : structuredClone(matches), error: null };
    },
    async maybeSingle() { return this.execute(true); }, async single() { return this.execute(true); },
    then(done, fail) { return Promise.resolve(this.execute(false)).then(done, fail); },
  }; return query;
} };
const load = Module._load;
Module._load = function(request, ...args) {
  if (request === '@/lib/supabaseServer') return { supabaseServer: database };
  if (request === '@/lib/auditLogger') return { logAuditEvent: async event => audits.push(event) };
  if (request === '@/lib/dashboardSession') return { getDashboardSessionUserId: () => sessionId };
  return load.call(this, request, ...args);
};
const service = require('@/lib/reliefRequests');
const { POST } = require('@/app/api/relief-requests/[id]/review/route');
function reset(status = 'Endorsed', role = 3) {
  officer = { id: 'trusted-officer', role_id: role, status: 'active', first_name: 'Test', last_name: 'Officer', barangay_id: 1, barangay: 'Barangay Tanong' };
  sessionId = officer.id; audits = []; loseRace = false;
  rows = [{ id: 'request-1', user_id: 'resident-1', status, reviewed_by: null, reviewed_at: null, rejection_feedback: null, release_details: 'legacy', residents_v3: { resident_id: 'resident-1', barangay_id: 1, barangay_name: 'Barangay Tanong' } }];
}
async function submit(body = { action: 'feedback', rejection_feedback: ' Being processed ' }) {
  return POST({ json: async () => body }, { params: Promise.resolve({ id: 'request-1' }) });
}
test('feedback stores trusted identity, timestamp and audit while retaining Endorsed and legacy columns', async () => {
  reset(); const response = await submit({ action: 'feedback', rejection_feedback: ' Being processed ', reviewed_by: 'spoof', role_id: 1, barangay_id: 99 });
  assert.equal(response.status, 200);
  assert.equal(rows[0].status, 'Endorsed'); assert.equal(rows[0].reviewed_by, officer.id);
  assert.equal(rows[0].rejection_feedback, 'Being processed'); assert.ok(Number.isFinite(Date.parse(rows[0].reviewed_at)));
  assert.equal(rows[0].release_details, 'legacy'); assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_user_id, officer.id); assert.equal(audits[0].target_id, 'request-1');
  assert.equal(audits[0].action, 'RELIEF_REQUEST_FEEDBACK_PROVIDED'); assert.equal(audits[0].barangay_id, 1);
  assert.equal((await response.json()).data.result.rejection_feedback, 'Being processed');
});
test('missing/inactive session and unauthorized roles cannot submit', async () => {
  reset(); sessionId = null; assert.equal((await submit()).status, 401);
  reset(); officer.status = 'inactive'; assert.equal((await submit()).status, 401);
  for (const role of [2, 4, 99]) { reset('Endorsed', role); assert.equal((await submit()).status, 403); assert.equal(audits.length, 0); }
  reset('Endorsed', 1); assert.equal((await submit()).status, 200);
});
test('invalid actions, malformed bodies and empty/nontext feedback fail without writes', async () => {
  for (const body of [null, {}, { action: 'approve' }, { action: 'reject' }, ...['', '  ', null, {}, 42].map(rejection_feedback => ({ action: 'feedback', rejection_feedback }))]) {
    reset(); assert.equal((await submit(body)).status, 400); assert.equal(rows[0].reviewed_at, null); assert.equal(audits.length, 0);
  }
});
test('non-Endorsed states, duplicate and racing submissions cannot overwrite feedback', async () => {
  for (const status of ['Pending', 'Approved', 'Rejected', 'Completed']) { reset(status); assert.ok([404, 409].includes((await submit()).status)); assert.equal(audits.length, 0); }
  reset(); assert.equal((await submit()).status, 200); const before = structuredClone(rows);
  assert.equal((await submit()).status, 409); assert.deepEqual(rows, before); assert.equal(audits.length, 1);
  reset(); loseRace = true; assert.equal((await submit()).status, 409); assert.equal(audits.length, 0);
  reset(); const results = await Promise.all([submit(), submit()]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(audits.length, 1);
});
test('barangay list/detail and endorsement remain isolated and auditable', async () => {
  reset('Pending', 4);
  rows.push({ ...structuredClone(rows[0]), id: 'other', user_id: 'resident-2', residents_v3: { resident_id: 'resident-2', barangay_id: 2, barangay_name: 'Barangay Catmon' } });
  const own = await service.listReliefRequests(officer, 'barangay'); assert.deepEqual(own.map(r => r.id), ['request-1']);
  await assert.rejects(service.getReliefRequest('other', officer, 'barangay'), e => e.status === 403);
  await assert.rejects(service.endorseReliefRequest('other', officer), e => e.status === 403);
  await service.endorseReliefRequest('request-1', officer); assert.equal(rows[0].status, 'Endorsed'); assert.equal(audits[0].action, 'RELIEF_REQUEST_ENDORSED');
  await assert.rejects(service.endorseReliefRequest('request-1', officer), e => e.status === 409);
});
test('Barangay Tanong and Catmon queues are isolated by the authenticated assignment', async () => {
  reset('Pending', 4);
  rows.push({ id: 'catmon-request', user_id: 'resident-2', status: 'Pending', residents_v3: { resident_id: 'resident-2', barangay_id: 2, barangay_name: 'Barangay Catmon' } });
  const tanongRows = await service.listReliefRequests(officer, 'barangay');
  assert.deepEqual(tanongRows.map(r => r.id), ['request-1']);
  const catmonOfficer = { ...officer, id: 'catmon-officer', barangay_id: 2, barangay: 'Barangay Catmon' };
  assert.deepEqual((await service.listReliefRequests(catmonOfficer, 'barangay')).map(r => r.id), ['catmon-request']);
  await assert.rejects(service.getReliefRequest('catmon-request', officer, 'barangay'), e => e.status === 403);
  await assert.rejects(service.endorseReliefRequest('catmon-request', officer), e => e.status === 403);
  await service.endorseReliefRequest('catmon-request', catmonOfficer);
  assert.equal(rows.find(r => r.id === 'catmon-request').status, 'Endorsed');
});
test('CSWDD retains city-wide access while Barangay users cannot endorse as another role', async () => {
  reset('Endorsed', 3);
  rows.push({ id: 'catmon-endorsed', user_id: 'resident-2', status: 'Endorsed', residents_v3: { resident_id: 'resident-2', barangay_id: 2, barangay_name: 'Barangay Catmon' } });
  assert.deepEqual((await service.listReliefRequests(officer, 'cswdd')).map(r => r.id), ['request-1', 'catmon-endorsed']);
  assert.equal((await service.getReliefRequest('request-1', officer, 'cswdd')).resident.barangay_id, 1);
  assert.equal((await service.getReliefRequest('catmon-endorsed', officer, 'cswdd')).resident.barangay_id, 2);
  await assert.rejects(service.endorseReliefRequest('request-1', officer), e => e.status === 403);
});
test('CSWDD queue excludes pending requests and retains requests with feedback', async () => {
  reset(); rows.push({ ...structuredClone(rows[0]), id: 'pending', status: 'Pending' });
  await submit(); const results = await service.listReliefRequests(officer, 'cswdd');
  assert.equal(results.length, 1); assert.equal(results[0].rejection_feedback, 'Being processed');
});
