// Isolated local PostgreSQL schema checks for the unapplied family_members migration.
// Requires: SF_TEST_PG_SOCKET=/tmp/... node this-file
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const socket = process.env.SF_TEST_PG_SOCKET;
if (!socket || !socket.startsWith('/tmp/')) {
  throw Error('Set SF_TEST_PG_SOCKET to an isolated /tmp PostgreSQL socket. No production connection is accepted.');
}

const database = `smartflood_family_members_test_${process.pid}`;
const args = ['-X', '-h', socket, '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atq'];
const sql = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const query = command => execFileSync('psql', [...args, '-c', command], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const runSql = command => execFileSync('psql', args, { input: command, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const migration = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20260917000001_create_family_members.sql'), 'utf8');
const vulnerabilityMigration = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20260917000002_add_family_member_vulnerabilities.sql'), 'utf8');

const familyId = '10000000-0000-0000-0000-000000000001';
const secondFamilyId = '10000000-0000-0000-0000-000000000002';
const residentId = '20000000-0000-0000-0000-000000000001';
const secondResidentId = '20000000-0000-0000-0000-000000000002';

before(() => {
  execFileSync('createdb', ['-h', socket, database]);
  runSql(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create extension if not exists pgcrypto;
    create table families(family_id uuid primary key, family_name text not null, infant_count integer not null default 0, toddler_count integer not null default 0, elderly_count integer not null default 0, total_family_members integer not null default 1);
    create table residents_v3(resident_id uuid primary key, family_id uuid references families(family_id), first_name text, last_name text, birth_date date, age integer);
    create table resident_applications(application_id uuid primary key, birth_date date);
    insert into families values(${sql(familyId)}, 'Test Family', 2, 1, 3, 6);
    insert into families values(${sql(secondFamilyId)}, 'Second Family', 0, 0, 0, 1);
    insert into residents_v3 values(${sql(residentId)}, ${sql(familyId)}, 'First', 'Resident', '2000-01-01', 26);
    insert into residents_v3 values(${sql(secondResidentId)}, ${sql(secondFamilyId)}, 'Second', 'Resident', NULL, 42);
    insert into resident_applications values('30000000-0000-0000-0000-000000000001', '1990-01-01');
    grant all on all tables in schema public to service_role;
  `);
  runSql(migration);
  runSql(vulnerabilityMigration);
});

after(() => {
  execFileSync('dropdb', ['-h', socket, database]);
});

test('supports nullable resident, source application, and birth date fields', () => {
  query(`insert into family_members(family_id, full_name) values(${sql(familyId)}, 'Unlinked Member')`);
  query(`insert into family_members(family_id, resident_id, source_application_id, full_name, birth_date) values(${sql(familyId)}, ${sql(residentId)}, '30000000-0000-0000-0000-000000000001', 'Linked Member', '2020-01-01')`);
  assert.equal(query('select count(*) from family_members'), '2');
  assert.equal(query('select count(*) from family_members where resident_id is null and birth_date is null'), '1');
});

test('existing rows receive safe vulnerability defaults without inferred statuses', () => {
  assert.equal(
    query(`select is_pwd || ',' || is_pregnant || ',' || coalesce(pregnancy_weeks::text, 'NULL') || ',' || coalesce(pregnancy_baseline_at::text, 'NULL') || ',' || is_lactating || ',' || is_4ps from family_members where full_name='Unlinked Member'`),
    'false,false,NULL,NULL,false,false',
  );
});

test('enforces member pregnancy-week integrity', () => {
  query(`insert into family_members(family_id, full_name, is_pregnant, pregnancy_weeks, pregnancy_baseline_at) values(${sql(familyId)}, 'Pregnant Member', true, 24, '2026-09-17T04:00:00Z')`);
  assert.throws(() => query(`insert into family_members(family_id, full_name, is_pregnant, pregnancy_weeks) values(${sql(familyId)}, 'Missing Baseline', true, 24)`));
  assert.throws(() => query(`insert into family_members(family_id, full_name, is_pregnant, pregnancy_weeks, pregnancy_baseline_at) values(${sql(familyId)}, 'Missing Weeks', true, NULL, '2026-09-17T04:00:00Z')`));
  assert.throws(() => query(`insert into family_members(family_id, full_name, pregnancy_weeks) values(${sql(familyId)}, 'Invalid Weeks', 12)`));
  assert.throws(() => query(`insert into family_members(family_id, full_name, is_pregnant, pregnancy_weeks, pregnancy_baseline_at) values(${sql(familyId)}, 'Too Many Weeks', true, 43, '2026-09-17T04:00:00Z')`));
});

test('stores a structured application snapshot without changing legacy columns', () => {
  query(`update resident_applications set household_members='[{"member_id":"10000000-0000-4000-8000-000000000009","full_name":"Future Member","birth_date":null,"resident_id":null,"is_pwd":true,"is_pregnant":false,"pregnancy_weeks":null,"is_lactating":false,"is_4ps":false}]'::jsonb where application_id='30000000-0000-0000-0000-000000000001'`);
  assert.equal(query(`select household_members->0->>'full_name' from resident_applications where application_id='30000000-0000-0000-0000-000000000001'`), 'Future Member');
  assert.throws(() => query(`update resident_applications set household_members='{}'::jsonb where application_id='30000000-0000-0000-0000-000000000001'`));
});

test('enforces family and resident references and resident linkage uniqueness', () => {
  assert.throws(() => query(`insert into family_members(family_id, full_name) values('40000000-0000-0000-0000-000000000001', 'Invalid Family')`));
  assert.throws(() => query(`insert into family_members(family_id, resident_id, full_name) values(${sql(familyId)}, '40000000-0000-0000-0000-000000000001', 'Invalid Resident')`));
  assert.throws(() => query(`insert into family_members(family_id, resident_id, full_name) values(${sql(familyId)}, ${sql(residentId)}, 'Duplicate Resident')`));
});

test('allows duplicate names and birth dates without collapsing members', () => {
  query(`insert into family_members(family_id, full_name, birth_date) values(${sql(familyId)}, 'Same Name', '2010-01-01')`);
  query(`insert into family_members(family_id, full_name, birth_date) values(${sql(familyId)}, 'Same Name', '2010-01-01')`);
  assert.equal(query(`select count(*) from family_members where full_name='Same Name' and birth_date='2010-01-01'`), '2');
});

test('preserves existing family and resident data', () => {
  assert.equal(query(`select infant_count || ',' || toddler_count || ',' || elderly_count || ',' || total_family_members from families where family_id=${sql(familyId)}`), '2,1,3,6');
  assert.equal(query(`select first_name || ',' || coalesce(birth_date::text, 'NULL') || ',' || age from residents_v3 where resident_id=${sql(residentId)}`), 'First,2000-01-01,26');
});

test('denies direct authenticated table access while service_role remains usable', () => {
  assert.throws(() => query('set role authenticated; select count(*) from family_members; reset role;'));
  assert.equal(query('set role service_role; select count(*) from family_members; reset role;'), '5');
});
