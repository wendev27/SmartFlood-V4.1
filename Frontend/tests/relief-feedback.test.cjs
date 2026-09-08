const assert = require('node:assert/strict'), { test } = require('node:test'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let selected, role, mutation, sent, index;
const resolve = Module._resolveFilename;
Module._resolveFilename = function(r, ...a) { return resolve.call(this, r.startsWith('@/') ? path.resolve(__dirname, '../src', r.slice(2)) : r, ...a); };
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, f);
require.extensions['.css'] = m => { m.exports = {}; };
const load = Module._load;
Module._load = function(r, ...a) {
  if (r === 'react') return { ...React, useState: initial => { const i = index++; return [i === 3 ? selected : i === 4 ? 'Processing request' : initial, () => {}]; } };
  if (r === '@/lib/authSession') return { getCurrentUser: () => ({}), normalizeUserRole: () => role };
  if (r === '@tanstack/react-query') return { useQueryClient: () => ({}), useQuery: () => ({ data: [selected] }), useMutation: options => { mutation = options; return { isPending: false }; } };
  if (r === '@/services/reliefService') return { reviewResidentReliefRequest: async (...v) => { sent = v; }, endorseResidentReliefRequest: async id => { sent = [id]; } };
  if (r === '@/components/ui/Modal/Modal') return { Modal: ({ children }) => children };
  return load.call(this, r, ...a);
};
const { ReliefEndorsement } = require('@/components/relief/ReliefEndorsement/ReliefEndorsement');
function render(status = 'Endorsed', feedback = null) {
  index = 0; sent = null;
  selected = { id: 'request-1', status, full_name: 'Test Resident', request_kind: 'family', relief_type: 'Food', reason: 'Flood', created_at: '2026-09-08T00:00:00Z', rejection_feedback: feedback, reviewed_at: feedback ? '2026-09-08T01:00:00Z' : null };
  return renderToStaticMarkup(React.createElement(ReliefEndorsement));
}
test('CSWDD and super render feedback controls and send the coordinated payload', async () => {
  for (role of ['cswdd', 'super']) {
    const html = render(); assert.match(html, /Provide Feedback/);
    assert.doesNotMatch(html, />Approve<|>Reject<|Release date|Release time|Release details|Rejection feedback/);
    await mutation.mutationFn(); assert.deepEqual(sent, ['request-1', { action: 'feedback', rejection_feedback: 'Processing request' }]);
  }
});
test('saved feedback and timestamp remain visible without duplicate submission controls', () => {
  role = 'cswdd'; const html = render('Endorsed', 'Additional information needed');
  assert.match(html, /Additional information needed/); assert.match(html, /Provided /); assert.doesNotMatch(html, /Provide Feedback|<textarea/);
});
test('barangay retains endorsement without CSWDD feedback controls', async () => {
  role = 'barangay'; const html = render('Pending'); assert.match(html, /Endorse to CSWDD/); assert.doesNotMatch(html, /Provide Feedback/);
  await mutation.mutationFn(); assert.deepEqual(sent, ['request-1']);
});
