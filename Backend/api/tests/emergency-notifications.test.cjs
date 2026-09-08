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

const notifications = [
  { notification_id: 'tanong-notification', target_type: 'barangay', target_barangay_id: 1, source_type: 'other', source_id: 'tanong-source', title: 'Tanong', message: 'Tanong allocation' },
  { notification_id: 'catmon-notification', target_type: 'barangay', target_barangay_id: 2, source_type: 'other', source_id: 'catmon-source', title: 'Catmon', message: 'Catmon allocation' },
  { notification_id: 'potrero-notification', target_type: 'barangay', target_barangay_id: 3, source_type: 'other', source_id: 'potrero-source', title: 'Potrero', message: 'Potrero allocation' },
];
const barangays = [{ barangay_id: 1 }, { barangay_id: 2 }, { barangay_id: 3 }];
let viewer;
let viewerRole;

const database = {
  from(table) {
    const filters = [];
    const query = {
      select() { return this; },
      eq(key, value) { filters.push(row => String(row[key]) === String(value)); return this; },
      order() { return this; },
      async maybeSingle() {
        const rows = table === 'barangays' ? barangays : notifications;
        return { data: rows.filter(row => filters.every(filter => filter(row)))[0] ?? null, error: null };
      },
      then(resolvePromise, rejectPromise) {
        const rows = table === 'barangays' ? barangays : notifications;
        return Promise.resolve({ data: rows.filter(row => filters.every(filter => filter(row))), error: null }).then(resolvePromise, rejectPromise);
      },
    };
    return query;
  },
};

const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === '@/lib/supabaseServer') return { supabaseServer: database };
  if (request === '@/lib/dashboardViewer') return {
    getDashboardViewer: async () => viewer,
    dashboardViewerRole: () => viewerRole,
  };
  if (request === '@/lib/barangayScope') return {
    assignedBarangayForUser: current => current ? { barangay_id: current.barangay_id, barangay_name: `Barangay ${current.barangay_id}` } : null,
  };
  return originalLoad.call(this, request, ...args);
};

const { GET } = require('@/app/api/emergency/notifications/route');

function request(query = '') {
  return { nextUrl: new URL(`http://localhost/api/emergency/notifications${query}`) };
}

async function responseData(response) {
  return response.json();
}

function setViewer(role, barangayId = null) {
  viewerRole = role;
  viewer = role ? { id: `${role}-viewer`, barangay_id: barangayId } : null;
}

test('Barangay scope ignores a client-selected foreign barangay', async () => {
  setViewer('barangay', 1);
  const response = await GET(request('?barangay_id=2'));
  const body = await responseData(response);
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.notifications.map(row => row.notification_id), ['tanong-notification']);
});

test('Super Admin contextual scope returns only the selected Barangay', async () => {
  setViewer('super');
  const tanong = await GET(request('?barangay_id=1'));
  const catmon = await GET(request('?barangay_id=2'));
  assert.deepEqual((await responseData(tanong)).data.notifications.map(row => row.notification_id), ['tanong-notification']);
  assert.deepEqual((await responseData(catmon)).data.notifications.map(row => row.notification_id), ['catmon-notification']);
});

test('Super Admin and CSWDD retain global visibility without a selected Barangay', async () => {
  setViewer('super');
  const superResponse = await GET(request());
  setViewer('cswdd');
  const cswddResponse = await GET(request());
  assert.equal((await responseData(superResponse)).data.notifications.length, 3);
  assert.equal((await responseData(cswddResponse)).data.notifications.length, 3);
});

test('Invalid contextual Barangay and unauthenticated requests are rejected', async () => {
  setViewer('super');
  const invalid = await GET(request('?barangay_id=999'));
  assert.equal(invalid.status, 400);
  setViewer(null);
  const unauthenticated = await GET(request('?barangay_id=1'));
  assert.equal(unauthenticated.status, 401);
});
