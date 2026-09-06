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

const { createIncidentService } = require('@/lib/emergencyIncidentService');
const { feedbackInput, listInput, validatePhotos, PHOTO_LIMIT } = require('@/lib/emergencyIncidentRules');
const resident = { kind: 'resident', residentId: '10000000-0000-0000-0000-000000000001', barangayId: 1 };
const otherResident = { ...resident, residentId: '10000000-0000-0000-0000-000000000002' };
const barangay = { kind: 'barangay', userId: '20000000-0000-0000-0000-000000000001', barangayId: 1 };
const otherBarangay = { ...barangay, barangayId: 2 };
function form() {
  const data = new FormData(); data.set('location', 'Test fixture address');
  data.append('photos', new File([new Uint8Array([255,216,255,224,0,0,255,217])], 'photo.jpg', { type: 'image/jpeg' }));
  return data;
}
function fixture() {
  const rows = new Map(), files = new Map();
  const allowed = (r, a) => r && (a.kind === 'resident' ? a.residentId === r.user_id : a.barangayId === r.barangay_id);
  const repo = {
    resident: async id => ({ resident_id: id, barangay_id: 1, status: 'active' }),
    insert: async row => { const r = { ...row, resident_confirmed: false, feedback: null, rating: null }; rows.set(r.id, r); return { ...r }; },
    get: async (id, actor) => allowed(rows.get(id), actor) ? { ...rows.get(id) } : null,
    update: async (id, actor, expected, change) => {
      const r = rows.get(id); if (!allowed(r, actor) || r.status !== expected) return null;
      Object.assign(r, change); return { ...r };
    },
    list: async (actor, q) => ({ reports: [...rows.values()].filter(r => allowed(r, actor) && (!q.status || r.status === q.status)) }),
    upload: async (key, bytes, type) => { files.set(key, new Blob([bytes], { type })); },
    remove: async keys => keys.forEach(k => files.delete(k)),
    download: async key => { if (!files.has(key)) throw Error('missing photo'); return files.get(key); },
  };
  return { rows, files, repo, service: createIncidentService(repo, async () => {}) };
}
const rejectsStatus = (promise, status) => assert.rejects(promise, e => e.status === status);

test('resident creation derives identity and barangay from trusted registry and starts pending', async () => {
  const f = fixture(); const r = await f.service.create({ ...resident, barangayId: 999 }, form());
  assert.equal(r.user_id, resident.residentId); assert.equal(r.barangay_id, 1); assert.equal(r.status, 'pending');
  assert.equal(f.files.size, 1); assert.match(r.image_paths[0], new RegExp(`^${resident.residentId}/${r.id}/`));
});
test('creation rejects client identity, status and barangay injection', async () => {
  for (const key of ['user_id', 'barangay_id', 'status', 'image_paths']) {
    const data = form(); data.set(key, 'anything'); await rejectsStatus(fixture().service.create(resident, data), 400);
  }
});
test('inactive residents cannot create reports and barangay cannot impersonate resident', async () => {
  const f = fixture(); f.repo.resident = async () => ({ status: 'inactive' });
  await rejectsStatus(f.service.create(resident, form()), 403);
  await rejectsStatus(f.service.create(barangay, form()), 403); assert.equal(f.files.size, 0);
});
test('cross-barangay and cross-resident details are hidden', async () => {
  const f = fixture(), r = await f.service.create(resident, form());
  await rejectsStatus(f.service.detail(otherBarangay, r.id), 404);
  await rejectsStatus(f.service.detail(otherResident, r.id), 404);
});
test('pending → en_route → arrived → resident resolution persists feedback and enters history', async () => {
  const f = fixture(), r = await f.service.create(resident, form());
  const enRoute = await f.service.changeStatus(barangay, r.id, { status: 'en_route' }); assert.ok(enRoute.en_route_at);
  const arrived = await f.service.changeStatus(barangay, r.id, { status: 'arrived' }); assert.ok(arrived.arrived_at);
  assert.equal((await f.service.list(resident, { status: 'resolved' })).reports.length, 0);
  const resolved = await f.service.resolve(resident, r.id, { confirmed: true, feedback: 'Help received', rating: 5 });
  assert.equal(resolved.status, 'resolved'); assert.equal(resolved.feedback, 'Help received'); assert.equal(resolved.rating, 5);
  assert.equal(resolved.resident_confirmed, true); assert.ok(resolved.resolved_at);
  assert.equal((await f.service.list(resident, { status: 'resolved' })).reports.length, 1);
});
test('skipped/repeated/backward transitions and duplicate feedback are rejected', async () => {
  const f = fixture(), r = await f.service.create(resident, form());
  await rejectsStatus(f.service.changeStatus(barangay, r.id, { status: 'arrived' }), 409);
  await rejectsStatus(f.service.resolve(resident, r.id, { confirmed: true }), 409);
  await f.service.changeStatus(barangay, r.id, { status: 'en_route' });
  await rejectsStatus(f.service.changeStatus(barangay, r.id, { status: 'en_route' }), 409);
  await f.service.changeStatus(barangay, r.id, { status: 'arrived' });
  await f.service.resolve(resident, r.id, { confirmed: true });
  await rejectsStatus(f.service.resolve(resident, r.id, { confirmed: true, feedback: 'overwrite' }), 409);
  await rejectsStatus(f.service.changeStatus(barangay, r.id, { status: 'en_route' }), 409);
});
test('roles cannot perform each other’s transitions; wrong barangay cannot update', async () => {
  const f = fixture(), r = await f.service.create(resident, form());
  await rejectsStatus(f.service.changeStatus(resident, r.id, { status: 'en_route' }), 403);
  await rejectsStatus(f.service.changeStatus(otherBarangay, r.id, { status: 'en_route' }), 404);
  await rejectsStatus(f.service.resolve(barangay, r.id, { confirmed: true }), 403);
});
test('another resident cannot resolve an arrived report', async () => {
  const f = fixture(), r = await f.service.create(resident, form());
  await f.service.changeStatus(barangay, r.id, { status: 'en_route' });
  await f.service.changeStatus(barangay, r.id, { status: 'arrived' });
  await rejectsStatus(f.service.resolve(otherResident, r.id, { confirmed: true }), 404);
  assert.equal((await f.service.detail(resident, r.id)).status, 'arrived');
});
test('compare-and-set handles competing updates without double transition', async () => {
  const f = fixture(), r = await f.service.create(resident, form());
  const results = await Promise.allSettled([f.service.changeStatus(barangay, r.id, { status: 'en_route' }), f.service.changeStatus(barangay, r.id, { status: 'en_route' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});
test('photos require ownership and stored safe paths; no arbitrary storage lookup', async () => {
  const f = fixture(), r = await f.service.create(resident, form());
  assert.ok(await f.service.photo(barangay, r.id, '0') instanceof Blob);
  await rejectsStatus(f.service.photo(otherBarangay, r.id, '0'), 404);
  await rejectsStatus(f.service.photo(otherResident, r.id, '0'), 404);
  await rejectsStatus(f.service.photo(resident, r.id, '../0'), 404);
  f.rows.get(r.id).image_paths = ['other-resident/private.jpg'];
  await rejectsStatus(f.service.photo(resident, r.id, '0'), 404);
});
test('photos enforce count, size, MIME and file signature', async () => {
  const photo = form().get('photos');
  await rejectsStatus(validatePhotos([]), 400); await rejectsStatus(validatePhotos(Array(6).fill(photo)), 400);
  await rejectsStatus(validatePhotos([new File(['<svg></svg>'], 'bad.jpg', { type: 'image/jpeg' })]), 400);
  await rejectsStatus(validatePhotos([new File([new Uint8Array(PHOTO_LIMIT + 1)], 'big.jpg', { type: 'image/jpeg' })]), 400);
});
test('failed insert cleans uploads; committed insert with lost response keeps photos', async () => {
  const f = fixture(); f.repo.insert = async () => { throw Error('database failure'); };
  await assert.rejects(f.service.create(resident, form())); assert.equal(f.files.size, 0);
  const g = fixture(), insert = g.repo.insert; g.repo.insert = async row => { await insert(row); throw Error('response lost'); };
  const r = await g.service.create(resident, form()); assert.equal(r.status, 'pending'); assert.equal(g.files.size, 1);
});
test('feedback requires explicit true confirmation and validates rating', () => {
  for (const input of [{ confirmed: false }, { confirmed: 'true' }, { confirmed: true, rating: 0 }, { confirmed: true, rating: 6 }, { confirmed: true, rating: 2.5 }, { confirmed: true, feedback: 'x'.repeat(2001) }]) assert.throws(() => feedbackInput(input));
});
test('queries enforce scope and bounded pagination and reject duplicate parameters', () => {
  assert.equal(listInput(new URLSearchParams('status=resolved&page=2&search=River'), barangay).page, 2);
  for (const query of ['barangay_id=2', 'limit=1000', 'page=-1', 'page=1&page=2', 'status=Pending', 'search=' + 'a'.repeat(101)]) assert.throws(() => listInput(new URLSearchParams(query), barangay));
});

// HTTP tests exercise the real route/auth/error boundary. Only existing dashboard
// identity lookup is stubbed; no test pretends that mobile authentication is implemented.
let viewer = null;
const dashboard = require('@/lib/dashboardViewer'); dashboard.getDashboardViewer = async () => viewer;
const { NextRequest } = require('next/server');
const collection = require('@/app/api/emergency-reports/route');
test('HTTP rejects unauthenticated callers without querying reports', async () => {
  viewer = null; const response = await collection.GET(new NextRequest('http://localhost/api/emergency-reports'));
  assert.equal(response.status, 401); assert.equal((await response.json()).success, false);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('HTTP rejects unconfigured resident credentials instead of trusting a body/header ID', async () => {
  const response = await collection.POST(new NextRequest('http://localhost/api/emergency-reports', { method: 'POST', headers: { Authorization: 'Bearer unverified', 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: resident.residentId }) }));
  assert.equal(response.status, 503);
});
test('HTTP rejects unsupported dashboard roles and forged barangay filters', async () => {
  viewer = { id: barangay.userId, role_id: 1, role_name: 'super_admin', role_label: 'Super Admin', barangay_id: 1, barangay: 'Tanong' };
  assert.equal((await collection.GET(new NextRequest('http://localhost/api/emergency-reports'))).status, 403);
  viewer = { ...viewer, role_id: 4, role_name: 'barangay_admin', role_label: 'Barangay Admin' };
  assert.equal((await collection.GET(new NextRequest('http://localhost/api/emergency-reports?barangay_id=2'))).status, 403);
});
test('HTTP photo route rejects anonymous access and suppresses shared caching', async () => {
  viewer = null;
  const photoRoute = require('@/app/api/emergency-reports/[id]/photos/[index]/route');
  const response = await photoRoute.GET(new NextRequest('http://localhost/api/emergency-reports/30000000-0000-0000-0000-000000000001/photos/0'), {
    params: Promise.resolve({ id: '30000000-0000-0000-0000-000000000001', index: '0' }),
  });
  assert.equal(response.status, 401); assert.match(response.headers.get('cache-control'), /no-store/);
});
test('multipart parser accepts five maximum-size photos and rejects oversized streamed bodies', async () => {
  const { incidentForm } = require('@/lib/emergencyIncidentHttp');
  const { BODY_LIMIT } = require('@/lib/emergencyIncidentRules');
  const bytes = new Uint8Array(PHOTO_LIMIT); bytes.set([255,216,255]);
  const f = new FormData(); f.set('location', 'Maximum size fixture');
  for (let i = 0; i < 5; i++) f.append('photos', new File([bytes], `${i}.jpg`, { type: 'image/jpeg' }));
  const parsed = await incidentForm(new NextRequest('http://localhost/api/emergency-reports', { method: 'POST', body: f }), resident);
  assert.equal((await validatePhotos(parsed.getAll('photos'))).length, 5);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(BODY_LIMIT + 1)); controller.close(); } });
  const request = new NextRequest('http://localhost/api/emergency-reports', { method: 'POST', body: stream, duplex: 'half', headers: { 'Content-Type': 'multipart/form-data; boundary=fixture' } });
  await rejectsStatus(incidentForm(request, resident), 413);
});

// Exercise the production repository against the supplied eight-column contract.
const { createIncidentRepository } = require('@/lib/emergencyIncidentRepository');
function existingSchemaClient() {
  const person = { resident_id: resident.residentId, barangay_id: 1, first_name: 'Fixture', last_name: 'Resident', contact_number: 'fixture-phone' };
  const rows = [
    { id: '30000000-0000-0000-0000-000000000001', user_id: resident.residentId, location: 'Fixture street', description: null, image_paths: ['fixture'], status: 'Pending', created_at: '2026-09-07T00:00:00Z', updated_at: '2026-09-07T00:00:00Z', resident: person },
    { id: '30000000-0000-0000-0000-000000000002', user_id: otherResident.residentId, location: 'Foreign street', description: null, image_paths: ['fixture'], status: 'Resolved', created_at: '2026-09-07T00:00:00Z', updated_at: '2026-09-07T00:00:00Z', resident: { ...person, resident_id: otherResident.residentId, barangay_id: 2 } },
  ];
  const client = { from(table) {
    assert.equal(table, 'emergency_reports'); let predicates = [], change, start = 0, end = Infinity;
    const builder = {
      select(columns) { assert.ok(!/en_route_at|arrived_at|resident_confirmed|feedback|rating/.test(columns)); return builder; },
      eq(key,value) { predicates.push(row => key.split('.').reduce((v,k)=>v?.[k],row)===value); return builder; },
      in(key,values) { predicates.push(row=>values.includes(row[key])); return builder; },
      order() { return builder; }, range(a,b) { start=a; end=b; return builder; },
      update(values) { assert.deepEqual(Object.keys(values).sort(),['status','updated_at']); assert.ok(['Pending','En Route','On Scene','Resolved'].includes(values.status)); change=values; return builder; },
      async maybeSingle() { const result=run(); return { data:result[0]||null,error:null }; },
      then(resolve,reject) { return Promise.resolve({data:run(),error:null}).then(resolve,reject); },
    };
    function run() { const result=rows.filter(r=>predicates.every(p=>p(r))); if(change) result.forEach(r=>Object.assign(r,change)); return result.slice(start,end+1).map(r=>structuredClone(r)); }
    return builder;
  } };
  return { client, rows };
}
test('production repository writes On Scene and only existing columns for barangay updates', async()=>{
  const f=existingSchemaClient(), repo=createIncidentRepository(f.client), service=createIncidentService(repo,async()=>{}), id=f.rows[0].id;
  await service.changeStatus(barangay,id,{status:'en_route'}); assert.equal(f.rows[0].status,'En Route');
  const result=await service.changeStatus(barangay,id,{status:'arrived'}); assert.equal(f.rows[0].status,'On Scene');
  assert.equal(result.status,'arrived'); assert.equal(result.arrived_at,null); assert.equal(result.resident_confirmed,null);
  await rejectsStatus(service.resolve(resident,id,{confirmed:true,feedback:'No storage column exists'}),503);
  assert.equal(f.rows[0].status,'On Scene');
});
test('production repository scopes counts/search/history and rejects foreign updates before writing',async()=>{
  const f=existingSchemaClient(), repo=createIncidentRepository(f.client), service=createIncidentService(repo,async()=>{});
  const list=await repo.list(barangay,{search:'',page:1,limit:7}); assert.equal(list.pagination.total,1); assert.equal(list.counts.resolved,0);
  assert.equal((await repo.list(barangay,{search:'Foreign',page:1,limit:7})).pagination.total,0);
  const history=await repo.list(otherBarangay,{status:'resolved',search:'',page:1,limit:7}); assert.equal(history.reports.length,1);
  assert.equal(history.reports[0].resident_confirmed,null);
  await rejectsStatus(service.changeStatus(otherBarangay,f.rows[0].id,{status:'en_route'}),404); assert.equal(f.rows[0].status,'Pending');
});

test('On Scene rows are presented and counted as arrived', async()=>{
  const f=existingSchemaClient(); f.rows[0].status='On Scene';
  const repo=createIncidentRepository(f.client);
  const list=await repo.list(barangay,{search:'',status:'arrived',page:1,limit:7});
  assert.equal(list.reports.length,1); assert.equal(list.counts.arrived,1);
  assert.equal(list.reports[0].status,'arrived');
});
