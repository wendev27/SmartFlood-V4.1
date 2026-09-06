// Destructive fixtures ONLY in a newly created, uniquely named local test database.
// Requires an isolated PostgreSQL socket: SF_TEST_PG_SOCKET=/tmp/... node this-file.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.resolve(__dirname, '../src', request.slice(2)) : request, ...args); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { createIncidentService } = require('@/lib/emergencyIncidentService');
const socket = process.env.SF_TEST_PG_SOCKET;
if (!socket || !socket.startsWith('/tmp/')) throw Error('Set SF_TEST_PG_SOCKET to an isolated /tmp PostgreSQL socket. No production connection is accepted.');
const database = `smartflood_incident_test_${process.pid}`;
const args = ['-X', '-h', socket, '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = value => value == null ? 'NULL' : typeof value === 'boolean' ? String(value) : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
function query(command) { return execFileSync('psql', [...args, '-c', command], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
const json = command => { const out = query(command); return out ? JSON.parse(out) : null; };
const resident = { kind: 'resident', residentId: '10000000-0000-0000-0000-000000000001', barangayId: 1 };
const other = { kind: 'resident', residentId: '10000000-0000-0000-0000-000000000002', barangayId: 2 };
const barangay = { kind: 'barangay', userId: '20000000-0000-0000-0000-000000000001', barangayId: 1 };
const foreignBarangay = { ...barangay, barangayId: 2 };
const scope = actor => actor.kind === 'resident' ? `user_id=${sql(actor.residentId)}` : `barangay_id=${sql(actor.barangayId)}`;
const files = new Map();
// Service uses actual PostgreSQL persistence/CAS and the production list RPC.
// Storage bytes are local fixtures; Supabase Storage itself is not simulated as a live test.
const stored = { pending: 'Pending', en_route: 'En Route', arrived: 'On Scene', resolved: 'Resolved' };
const { mapIncident } = require('@/lib/emergencyIncidentRepository');
const mapped = r => r ? mapIncident({ ...r, resident: json(`select to_jsonb(p) from residents_v3 p where resident_id=${sql(r.user_id)}`) }) : null;
const scoped = actor => actor.kind === 'resident' ? `user_id=${sql(actor.residentId)}` : `user_id in (select resident_id from residents_v3 where barangay_id=${sql(actor.barangayId)})`;
const repo = {
  resident: async id => json(`select to_jsonb(r) from residents_v3 r where resident_id=${sql(id)}`),
  insert: async row => {
    const { barangay_id, ...insert } = row; insert.status = 'Pending';
    return mapped(json(`with r as (insert into emergency_reports(${Object.keys(insert).join(',')}) values(${Object.values(insert).map(v=>Array.isArray(v)?`array[${v.map(sql).join(',')}]::text[]`:sql(v)).join(',')}) returning *) select to_jsonb(r) from r`));
  },
  get: async (id, actor) => mapped(json(`select to_jsonb(r) from emergency_reports r where id=${sql(id)} and ${scoped(actor)}`)),
  update: async (id, actor, expected, change) => mapped(json(`with r as (update emergency_reports set status=${sql(stored[change.status])},updated_at=clock_timestamp() where id=${sql(id)} and ${scoped(actor)} and status=${sql(stored[expected])} returning *) select to_jsonb(r) from r`)),
  upload: async (key,bytes,type)=>files.set(key,new Blob([bytes],{type})),
  remove: async keys=>keys.forEach(key=>files.delete(key)),
  download: async key=>files.get(key),
};
const service = createIncidentService(repo, async () => {});
function form(location = 'Integration fixture') {
  const f = new FormData(); f.set('location', location);
  f.append('photos', new File([new Uint8Array([255,216,255,224,255,217])], 'fixture.jpg', { type: 'image/jpeg' })); return f;
}
before(() => {
  execFileSync('createdb', ['-h', socket, database]);
  query(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema storage;
    create table barangays(barangay_id bigint primary key, barangay_name text);
    create table residents_v3(resident_id uuid primary key, barangay_id bigint references barangays,
      first_name text, middle_name text, last_name text, suffix text, contact_number text, status text default 'active');
    create table emergency_reports(id uuid primary key default gen_random_uuid(),user_id uuid not null references residents_v3,
      location text not null check(char_length(location) between 3 and 300),description text check(description is null or char_length(description) between 1 and 2000),image_paths text[] not null check(cardinality(image_paths) between 1 and 5),status text not null default 'Pending' check(status in ('Pending','En Route','On Scene','Resolved','Rejected','Cancelled')),
      created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create policy legacy_allow_all on storage.objects for all to authenticated using(true) with check(true);
    grant usage on schema public,storage to anon,authenticated,service_role;
    grant all on all tables in schema public,storage to anon,authenticated,service_role;
    insert into barangays values(1,'Test one'),(2,'Test two');
    insert into residents_v3(resident_id,barangay_id,first_name,last_name,contact_number) values
      (${sql(resident.residentId)},1,'First','Resident','test-phone-one'),(${sql(other.residentId)},2,'Second','Resident','test-phone-two');
    insert into storage.buckets values('emergency-report-images',false,2097152,array['image/jpeg','image/png','image/webp']);
    insert into emergency_reports(user_id,location,image_paths,status) values
      (${sql(resident.residentId)},'Legacy pending',array['fixture.jpg'],'Pending'),(${sql(resident.residentId)},'Legacy route',array['fixture.jpg'],'En Route');
  `);
  query(`insert into emergency_reports(user_id,location,image_paths,status) values (${sql(resident.residentId)},'Legacy arrival',array['fixture.jpg'],'On Scene')`);

});
after(() => { execFileSync('dropdb', ['-h', socket, database]); });

test('existing eight-column schema and rows need no migration', () => {
  assert.equal(Number(query("select count(*) from information_schema.columns where table_name='emergency_reports'")), 8);
  assert.equal(Number(query('select count(*) from emergency_reports')), 3);
});
test('pending → en_route → arrived persists the existing title-case values', async () => {
  const r = await service.create(resident, form('Lifecycle fixture'));
  assert.equal(query(`select status from emergency_reports where id=${sql(r.id)}`), 'Pending');
  await assert.rejects(service.changeStatus(barangay,r.id,{status:'arrived'}), e=>e.status===409);
  await service.changeStatus(barangay,r.id,{status:'en_route'});
  assert.equal(query(`select status from emergency_reports where id=${sql(r.id)}`), 'En Route');
  const arrived=await service.changeStatus(barangay,r.id,{status:'arrived'});
  assert.equal(query(`select status from emergency_reports where id=${sql(r.id)}`), 'On Scene');
  assert.equal(arrived.status,'arrived'); assert.equal(arrived.arrived_at,null);
  assert.equal(arrived.resident_confirmed,null);
  assert.throws(()=>query(`update emergency_reports set status='Arrived' where id=${sql(r.id)}`));
  assert.equal(await repo.update(r.id,barangay,'pending',{status:'en_route'}),null);
});
test('foreign barangay/resident cannot read, advance, or download another report',async()=>{
  const r=await service.create(resident,form());
  await assert.rejects(service.detail(foreignBarangay,r.id),e=>e.status===404);
  await assert.rejects(service.changeStatus(foreignBarangay,r.id,{status:'en_route'}),e=>e.status===404);
  await assert.rejects(service.photo(other,r.id,'0'),e=>e.status===404);
  assert.equal(query(`select status from emergency_reports where id=${sql(r.id)}`),'Pending');
});
test('existing Resolved record remains resolved without manufacturing confirmation',async()=>{
  const r=await service.create(resident,form());
  query(`update emergency_reports set status='Resolved' where id=${sql(r.id)}`);
  const row=await service.detail(barangay,r.id);
  assert.equal(row.status,'resolved'); assert.equal(row.resident_confirmed,null); assert.equal(row.resolved_at,null);
  await assert.rejects(service.changeStatus(barangay,r.id,{status:'en_route'}),e=>e.status===409);
});

test('existing On Scene rows remain unchanged and read as arrived', async()=>{
  assert.equal(query("select status from emergency_reports where location='Legacy arrival'"),'On Scene');
  const id=query("select id from emergency_reports where location='Legacy arrival'");
  assert.equal((await service.detail(barangay,id)).status,'arrived');
});
