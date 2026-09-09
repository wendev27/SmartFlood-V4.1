// Run with: node tests/presentation.test.cjs (uses only installed dependencies).
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const src = path.resolve(__dirname, "../src");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(src, request.slice(2)) : request, ...args);
};
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
      fileName: filename,
    });
    module._compile(result.outputText, filename);
  };
}
require.extensions[".css"] = (module) => { module.exports = new Proxy({}, { get: (_, key) => key === "__esModule" ? false : String(key) }); };

const { navigationItemsForRole } = require("@/data/navigation");
const { navigationPresentation } = require("@/adapters/navigationPresentation");
const { alertActivityPresentation } = require("@/adapters/alertActivityPresentation");
const { Pagination } = require("@/components/ui/Pagination/Pagination");
const { EmptyState } = require("@/components/ui/EmptyState");
const { StatCard } = require("@/components/ui/StatCard/StatCard");
const { ApplicationCard } = require("@/components/verification/ApplicationCard/ApplicationCard");
const { EmergencyReportPanel, EmergencyReportPresentation, EmergencyReportDetails, EvidenceCarousel } = require("@/components/emergency/EmergencyReportPanel/EmergencyReportPanel");
const { historyNarrativePresentation } = require("@/components/monitoring/MonitoringPanel/historyPresentation");
const { profileSealForRole } = require("@/adapters/profilePresentation");
const { notificationPresentation } = require("@/adapters/notificationPresentation");
const { toDistributionPresentation } = require("@/components/relief/CswddDistributionModule/distributionPresentation");
const { NotificationPanel } = require("@/components/notifications/NotificationPanel/NotificationPanel");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const { queryKeys } = require("@/lib/queryKeys");
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("navigation preserves role destinations and Barangay group structure", () => {
  const expected = {
    super: ["dashboard", "monitoring", "relief", "reliefManagement", "reliefDistribution", "residents", "accounts", "logs", "systemLogs"],
    cswdd: ["dashboard", "monitoring", "relief", "residents", "systemLogs"],
    cdrrmo: ["dashboard", "monitoring", "systemLogs"],
    barangay: ["dashboard", "monitoring", "emergencyNotifications", "reliefDistribution", "residents", "accounts", "systemLogs"],
  };
  for (const [role, keys] of Object.entries(expected)) {
    const items = navigationItemsForRole(role);
    assert.deepEqual(items.map((item) => item.key), keys);
    const original = JSON.stringify(items);
    const grouped = navigationPresentation(items, role);
    const flattened = [...grouped.primary, ...grouped.groups.flatMap((group) => group.items)];
    assert.equal(flattened.some((item) => item.key === "sensors" || item.label === "Sensor History"), false);
    if (role === "cswdd") {
      assert.deepEqual(flattened.filter((item) => ["relief", "reliefManagement", "reliefDistribution"].includes(item.key)).map((item) => item.key), ["relief"]);
    }
    assert.equal(flattened.some((item) => item.key === "reliefManagement"), false);
    const visibleKeys = role === "barangay" ? keys.filter((key) => key !== "reliefDistribution") : keys;
    if (role === "super") {
      assert.deepEqual(grouped.groups.map((group) => group.label), ["CSWDD", "Barangay Tanong", "Barangay Catmon", "Barangay Potrero"]);
      assert.deepEqual(grouped.groups.find((group) => group.label === "CSWDD").items.map((item) => item.key), ["relief", "residents"]);
      assert.equal(grouped.groups.filter((group) => group.label.startsWith("Barangay")).every((group) => group.items.map((item) => item.key).join("|") === "emergencyNotifications|reliefDistribution|residents|accounts"), true);
      assert.equal(grouped.groups.filter((group) => group.label.startsWith("Barangay")).every((group) => group.items.map((item) => item.label).join("|") === "Relief Management|Emergency Report Management|Resident Information|Resident Account Registration Management"), true);
    } else {
      assert.deepEqual(flattened.map((item) => item.key).sort(), [...visibleKeys].sort());
      assert.equal(new Set(flattened.map((item) => item.key)).size, visibleKeys.length);
    }
    assert.equal(JSON.stringify(items), original, "presentation must not mutate role navigation definitions");
    assert.equal(flattened.find((item) => item.key === "dashboard").label, "Home");
    if (role !== "super") assert.equal(grouped.groups.length, 0, "REY uses flat role navigation outside the super-user groups");
    assert.equal(flattened.some((item) => item.key === "reliefDistribution"), role !== "barangay" && keys.includes("reliefDistribution"));
    if (role !== "super") assert.ok(flattened.every((item) => item.key !== "reliefDistribution" || !/Emergency Report/.test(item.label)));
  }
});

test("pagination keeps server totals and the current middle page", () => {
  const html = render(Pagination, { pagination: { page: 7, limit: 5, total: 190, totalPages: 38 }, onPageChange() {} });
  assert.match(html, /aria-current="page"[^>]*>7<\/button>/);
  assert.match(html, /Showing 31–35 of 190/);
  assert.match(html, />Previous<\/button>/);
  assert.match(html, />Next<\/button>/);
  const control = Pagination({ pagination: { page: 7, limit: 5, total: 190, totalPages: 38 }, onPageChange: (page) => { assert.equal(page, 8); } });
  const buttons = control.props.children[1].props.children;
  buttons[2].props.onClick();
});

test("pagination still hides a single page", () => {
  assert.equal(render(Pagination, { pagination: { page: 1, limit: 5, total: 3, totalPages: 1 }, onPageChange() {} }), "");
});

test("empty-state illustration preserves the caller's explanation and action", () => {
  const html = render(EmptyState, { title: "No families match this search", description: "Clear the barangay filter to continue.", actionLabel: "Reset filters", onAction() {} });
  assert.match(html, /No families match this search/);
  assert.match(html, /Clear the barangay filter to continue/);
  assert.match(html, /Reset filters/);
});

test("interactive statistic cards keep Enter and Space activation", () => {
  let clicks = 0;
  let prevented = 0;
  const card = StatCard({ stat: { label: "Severe Alerts", value: "2", caption: "View severe sensors", tone: "cyan" }, onClick: () => clicks++ });
  assert.equal(card.props.tabIndex, 0);
  for (const key of ["Enter", " ", "Escape"]) card.props.onKeyDown({ key, preventDefault: () => prevented++ });
  card.props.onClick();
  assert.equal(clicks, 3);
  assert.equal(prevented, 2);
});

test("current alert presentation omits absent and normal readings without inventing timestamps", () => {
  const rows = alertActivityPresentation([
    { sensorId: "normal", waterLevelM: 0.1, computedStatus: "normal" },
    { sensorId: "missing", waterLevelM: null, computedStatus: "severity" },
    { sensorId: "invalid", waterLevelM: "invalid", computedStatus: "severity" },
    { sensorId: "warning", waterLevelM: 0.9, computedStatus: "flood_warning", barangayName: "Barangay Catmon" },
    { sensorId: "severe", waterLevelM: 1.4, computedStatus: "severity", barangayName: "Barangay Potrero", updatedAt: "2026-09-07T00:00:00Z" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tone, "warning");
  assert.match(rows[0].title, /Catmon/);
  assert.equal(rows[0].meta, "warning recorded 0.90m");
  assert.equal(rows[1].tone, "critical");
  assert.match(rows[1].meta, /2026/);
  assert.deepEqual(alertActivityPresentation([]), []);
});

test("approved and rejected applications keep their View action", () => {
  for (const status of ["approved", "rejected"]) {
    const html = render(ApplicationCard, { application: { application_id: "test-application", name: "Test resident", type: "Family Head", status, barangay: "Barangay Catmon", address: "Test address", initials: "TR", phone: "", familyMembers: "1", submitted: "Not recorded" }, onReview() {} });
    assert.match(html, /View<\/button>/);
  }
});

test("emergency landing presents real-data navigation without sample records or counts", () => {
  const html = render(EmergencyReportPanel);
  assert.match(html, /Emergency Report/);
  assert.match(html, /Emergency Report History/);
  assert.doesNotMatch(html, /Emergency reporting is unavailable/);
  assert.match(html, /Emergency Report History/);
  assert.doesNotMatch(html, /Sebastian|May 12|flood-house|Mark as|Showing \d/);
});

test("unavailable emergency presentation cannot expose records or invent pagination totals", () => {
  const html = render(EmergencyReportPresentation, { view: "reports", onViewChange() {}, state: "unavailable", statusFilter: "Pending", onStatusFilterChange() {}, query: "", onQueryChange() {},
    reports: [{ id: "test-only", residentName: "Hidden fixture", status: "Pending", photos: [] }], statusCounts: { Pending: 123 }, onPageChange() {} });
  assert.match(html, /Phone Number/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Hidden fixture|>123<|Showing \d/);
});

test("emergency status buttons require a callback and never manufacture a saved result", () => {
  const report = { id: "test-only", residentName: "Test resident", status: "Pending", photos: [], location: null, phone: null, description: null, submittedAtLabel: null };
  const html = render(EmergencyReportDetails, { report, onClose() {} });
  assert.match(html, /disabled=""/);
  assert.match(html, /Submission time unavailable/);
  assert.match(html, /Response status updates are unavailable/);
  assert.doesNotMatch(html, /role="status"|successfully/);
  let request;
  const details = EmergencyReportDetails({ report, onClose() {}, onAdvance: (row, nextStatus) => { request = [row.id, nextStatus]; } });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && node.props["data-status"] === "Pending") node.props.onClick();
    React.Children.forEach(node.props?.children, visit);
  }
  visit(details);
  assert.deepEqual(request, ["test-only", "En Route"]);
  assert.equal(report.status, "Pending");
});

test("emergency carousel counts supplied photos and has an honest missing-photo state", () => {
  const empty = render(EvidenceCarousel, { photos: [] });
  assert.match(empty, /No report photos available/);
  assert.doesNotMatch(empty, /<img|0 \/ 0/);
  const html = render(EvidenceCarousel, { photos: [{ id: "test-1", url: "/test-fixture-1.jpg", description: "First test image" }, { id: "test-2", url: "/test-fixture-2.jpg", description: "Second test image" }] });
  assert.match(html, /1 \/ 2/);
  assert.match(html, /Previous report photo/);
  assert.match(html, /Next report photo/);
  assert.match(html, /View report photo 2/);
});

test("history narratives use measurements and recorded timestamps without inventing impact", () => {
  const empty = historyNarrativePresentation([]);
  assert.match(empty.highestEvent, /No measured water level/);
  assert.doesNotMatch(empty.observationPeriod, /2026/);
  const result = historyNarrativePresentation([
    { sensorId: "test-sensor", sensorName: "Test sensor", barangayName: "Barangay Catmon", waterLevelM: 1.2, createdAt: "2026-09-07T00:00:00Z" },
    { sensorId: "test-sensor", sensorName: "Test sensor", barangayName: "Barangay Catmon", waterLevelM: null, createdAt: "invalid" },
  ]);
  assert.match(result.summary, /2 readings from 1 sensor/);
  assert.match(result.highestEvent, /1.20m.*Catmon/);
  assert.match(result.observationPeriod, /do not establish flood duration or resident impact/);
});

test("profile seals follow actual role and barangay without substituting another identity", () => {
  assert.equal(profileSealForRole("cswdd", "Barangay Catmon"), "/images/cswdd/cswdd-seal.png");
  assert.equal(profileSealForRole("barangay", "Barangay Tañong"), "/images/dashboard/barangay-tanong-seal.jpg");
  assert.equal(profileSealForRole("barangay", "Barangay Catmon"), null);
  assert.equal(profileSealForRole("barangay", "Longos resident"), null);
  assert.equal(profileSealForRole("cdrrmo", "Barangay Potrero"), null);
  assert.equal(profileSealForRole("super", "Barangay Longos"), null);
  assert.equal(profileSealForRole(undefined, "Barangay Longos"), null);
});

test("notification adapter preserves identity and recipient read status without fabricating event categories", () => {
  const records = ["pending", "sent", "read", "accepted", "rejected"].map((status, index) => ({
    notification_id: `notification-${index}`, title: `Allocation ${index}`, message: "Actual notification body", status, source_type: "emergency_allocation_item", type: "EMERGENCY_RELIEF_ALLOCATION",
  }));
  records.push({ notification_id: "unknown", title: "Other event", message: "Actual other body", status: "read", source_type: "unknown", type: "unknown" });
  records.push({ notification_id: "", title: "Missing identifier", message: "Omitted row", status: "pending" });
  const before = JSON.stringify(records);
  const rows = notificationPresentation(records);
  assert.deepEqual(rows.map((row) => row.id), ["notification-0", "notification-1", "notification-2", "notification-3", "notification-4", "unknown"]);
  assert.deepEqual(rows.map((row) => row.unread), [true, true, false, false, false, false]);
  assert.equal(rows[0].isAllocation, true);
  assert.equal(rows[0].message, records[0].message);
  assert.equal(rows[5].category, null);
  assert.equal(rows[5].isAllocation, false);
  assert.equal(JSON.stringify(records), before);
});

test("notification view suppresses cached barangay records for CDRRMO and exposes actual records to supported roles", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.notifications.emergency, [{ notification_id: "test-notification", title: "Scoped allocation fixture", message: "Scoped relief details", status: "sent", source_type: "emergency_allocation_item" }]);
  client.setQueryData(queryKeys.sensors.latest, []);
  const htmlFor = (role) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(NotificationPanel, { role, onBack() {}, onNavigate() {}, onOpenAllocation() {} })));
  const restricted = htmlFor("cdrrmo");
  assert.match(restricted, /Notification inbox unavailable/);
  assert.doesNotMatch(restricted, /Scoped allocation fixture|Scoped relief details/);
  for (const role of ["barangay", "cswdd", "super"]) {
    const html = htmlFor(role);
    assert.match(html, /Scoped allocation fixture/);
    assert.match(html, /Scoped relief details/);
    assert.match(html, /role="link"/);
  }
  client.clear();
});

test("distribution adapter preserves API identity, scope and verification time without inventing receipts", () => {
  const record = { distribution_id: "distribution-42", family_id: "family-7", family_name: "Recorded family", family_head_name: "Recorded head", barangay_id: 8, barangay_name: "Barangay Catmon", status: "received", verified_at: "2026-09-07T04:30:00Z" };
  const before = JSON.stringify(record);
  const row = toDistributionPresentation(record);
  assert.equal(row.id, record.distribution_id);
  assert.equal(row.barangay, "Barangay Catmon");
  assert.equal(row.familyHead, record.family_head_name);
  assert.equal(row.received, true);
  assert.equal(row.status, "Received");
  assert.equal(row.verifiedDate, new Date(record.verified_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
  assert.equal(row.verifiedTime, new Date(record.verified_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
  const missing = toDistributionPresentation({ ...record, verified_at: null, status: "pending" });
  assert.equal(missing.received, false);
  assert.equal(missing.status, "Pending");
  assert.equal(missing.verifiedDate, "Not recorded");
  assert.equal(missing.verifiedTime, "");
  assert.equal(JSON.stringify(record), before);
});

test("weather details render real observations and only the available forecast days", () => {
  const { WeatherForecastPanel } = require("@/components/weather/WeatherForecastPanel/WeatherForecastPanel");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const current = { time: "2026-09-07T00:00:00Z", temperature: 27, feelsLike: 30, humidity: 89, rainChance: 0, uvIndex: 0, windKmh: 7.56, pressureHpa: 1005, description: "Mostly cloudy", icon: "cloud" };
  client.setQueryData(["weather", "malabon"], { location: "Malabon City", timezone: "Asia/Manila", current, hourly: [current], daily: [{ time: current.time, high: 31, low: 25, rainChance: 65, description: "Rain", icon: "rain" }], intervalHours: 1, sources: ["Tomorrow.io"], notices: [] });
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(WeatherForecastPanel, { onBack() {} })));
  assert.match(html, /27°C/);
  assert.match(html, /89%/);
  assert.match(html, /0%/);
  assert.match(html, /8 km\/h/);
  assert.match(html, /1-Day Forecast/);
  assert.doesNotMatch(html, /7-Day Forecast|Weather observations and forecasts are unavailable/);
  assert.match(html, /Mostly cloudy/);
  client.clear();
});

test("weather errors expose retry without fabricated observations", () => {
  const { WeatherForecastPanel } = require("@/components/weather/WeatherForecastPanel/WeatherForecastPanel");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  client.getQueryCache().build(client, { queryKey: ["weather", "malabon"] }).setState({ status: "error", fetchStatus: "idle", error: new Error("Weather providers are unavailable.") });
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(WeatherForecastPanel, { onBack() {} })));
  assert.match(html, /Weather providers are unavailable/);
  assert.match(html, /Retry weather/);
  assert.match(html, /Observation time unavailable/);
  assert.doesNotMatch(html, /\d+°C/);
  client.clear();
});

const { incidentPresentation, incidentStatusForLabel } = require('@/adapters/emergencyIncidentPresentation');
test('incident adapter maps Arrived without inventing resident confirmation', () => {
  const row = { id: 'report-fixture', user_id: 'resident-fixture', barangay_id: 2, location: 'Fixture location', description: null, image_paths: ['resident/report/photo.jpg'], status: 'arrived', created_at: '2026-09-06T23:00:00Z', updated_at: '2026-09-06T23:00:00Z', resident_confirmed: null, feedback: null, resolved_at: null, resident: { resident_id: 'resident-fixture', name: 'Fixture Resident', phone: null } };
  const view = incidentPresentation(row);
  assert.equal(view.status, 'Arrived'); assert.equal(incidentStatusForLabel.Arrived, 'arrived');
  assert.equal(view.residentConfirmation, null); assert.equal(view.phone, null);
  assert.equal(view.photos[0].url, '/api/emergency-reports/report-fixture/photos/0');
  assert.equal(incidentPresentation({ ...row, status: 'resolved' }).residentConfirmation, null);
});
