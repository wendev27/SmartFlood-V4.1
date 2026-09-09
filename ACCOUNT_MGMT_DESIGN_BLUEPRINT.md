# Account Management Module Design Blueprint

**Extraction Date:** 2026-09-10  
**Reference Repository:** SmartFlood-V3.2rey  
**Component Location:** `src/components/logs/AccountManagement/AccountManagement.tsx`  
**Purpose:** Structural blueprint for replicating the Account Management UI design

---

## 1. Container & Layout

**File:** `src/components/logs/AccountManagement/AccountManagement.tsx` (line 377)

**JSX Structure:**
```tsx
<article className={styles.card}>
  <div className={styles.toolbar}>
    {/* Toolbar content */}
  </div>
  <DataTable className={styles.tableScroll} headers={["Email", "Role", "Department", "Actions", "Status", "Actions"]} minWidth={1002}>
    {/* Table content */}
  </DataTable>
  <SharedPagination pagination={paginatedUsers.pagination} onPageChange={setPage} label="Account users" compact alwaysVisible />
</article>
```

**CSS Classes/Modules Applied:**
- **`.card`** (Main container):
  - `background: #fff`
  - `border: 0`
  - `border-radius: 14px`
  - `box-shadow: 0 1px 3px rgba(0, 0, 0, .1), 0 1px 2px rgba(0, 0, 0, .1)`
  - `display: flex; flex-direction: column`
  - `margin: 28px auto 0`
  - `max-width: none`
  - `min-height: 650px`
  - `padding: 24px 24px 20px`
  - `font-family: "Source Sans Pro", ui-sans-serif, system-ui, sans-serif`

---

## 2. Toolbar (Search & Filters)

**File:** `src/components/logs/AccountManagement/AccountManagement.tsx` (lines 378-411)

**Structure:**
```tsx
<div className={styles.toolbar}>
  <label className={styles.search}>
    <span />
    <input
      type="search"
      placeholder="Search by name, email, mobile, role, or status..."
      value={search}
      onChange={(event) => setSearch(event.target.value)}
    />
  </label>
  <select aria-label="Department" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
    <option value="">All Departments</option>
    {departmentOptions.map((department) => <option key={department} value={department}>{formatBarangayName(department)}</option>)}
  </select>
  <select aria-label="Role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
    <option value="">All Roles</option>
    {roleFilterOptions.map((role) => <option key={role} value={role}>{role}</option>)}
  </select>
  <select aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
    <option value="">All Status</option>
    <option value="active">Enabled</option>
    <option value="inactive">Disabled</option>
    <option value="blocked">Blocked</option>
  </select>
  <button type="button" className={styles.exportButton} onClick={exportAccounts}>
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
    Export
  </button>
  <button type="button" className={styles.addButton} onClick={openAddForm}><span aria-hidden="true">＋</span>Add New</button>
</div>
```

**CSS Classes:**

**`.toolbar` (Layout wrapper):**
- `align-items: center`
- `display: grid`
- `gap: 6px`
- `grid-template-columns: 1fr` (mobile)
- `margin-bottom: 24px`
- **Desktop (min-width: 900px):** `grid-template-columns: 252px 190px 112px 112px 1fr 112px 112px`

**`.search` (Search input wrapper):**
- `align-items: center`
- `border: 1px solid #cbd5e1`
- `border-radius: 10px`
- `display: flex`
- `height: 42px`
- `padding: 0 12px`

**`.search span` (Search icon):**
- `border: 2px solid #94a3b8`
- `border-radius: 50%`
- `height: 15px`
- `margin-right: 10px`
- `position: relative`
- `width: 15px`

**`.search input` and `.toolbar select`:**
- `background: #ffffff`
- `border: 0`
- `color: #64748b`
- `font-size: 14px`
- `font-weight: 400`
- `line-height: 20px`
- `min-width: 0`
- `outline: 0`
- `width: 100%`

**`.toolbar select` (Dropdown styling):**
- `border: 1px solid #cbd5e1`
- `border-radius: 10px`
- `height: 40px`
- `padding: 0 8px`

**`.exportButton` (Export button):**
- `background: #ffffff`
- `border: 1px solid #cbd5e1`
- `color: #64748b`
- `align-items: center`
- `border-radius: 10px`
- `display: flex`
- `font-size: 14px`
- `font-weight: 400`
- `gap: 8px`
- `height: 40px`
- `justify-content: center`
- `padding: 0 10px`
- `width: 100px`
- `white-space: nowrap`

**`.addButton` (Add New button):**
- `background: #0088ff`
- `border: 1px solid #0088ff`
- `color: #ffffff`
- `align-items: center`
- `border-radius: 10px`
- `display: flex`
- `font-size: 14px`
- `font-weight: 400`
- `gap: 8px`
- `height: 40px`
- `justify-content: center`
- `padding: 0 10px`
- `width: 100px`
- `white-space: nowrap`

---

## 3. Data Table

**File:** `src/components/logs/AccountManagement/AccountManagement.tsx` (lines 413-448)

**Table Wrapper:**
```tsx
<DataTable className={styles.tableScroll} headers={["Email", "Role", "Department", "Actions", "Status", "Actions"]} minWidth={1002}>
  {paginatedUsers.rows.map((user, index) => (
    <tr key={user.id || `${user.email}-${index}`}>
      <td><a className={styles.emailLink} href={`mailto:${user.email}`}>{user.email}</a></td>
      <td>{displayRole(user)}</td>
      <td><strong className={styles.department}>{formatBarangayName(user.department)}</strong></td>
      <td>{accountActivity(user)}</td>
      <td><span className={user.status === "active" ? styles.enabled : styles.disabled}>{statusLabel(user.status)}</span></td>
      <td>
        <div className={styles.rowActions}>
          <button className={styles.actionPill} type="button" onClick={() => setPreviewUser(user)}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path opacity=".4" d="M19.48 8.39C17.36 5.06 14.26 3.14 11 3.14c-3.26 0-6.36 1.92-8.48 5.25-.92 1.44-.92 3.78 0 5.21 2.12 3.34 5.22 5.25 8.48 5.25 3.26 0 6.36-1.91 8.48-5.25.92-1.43.92-3.78 0-5.21ZM11 14.7A3.7 3.7 0 1 1 11 7.3a3.7 3.7 0 0 1 0 7.4Z" fill="currentColor"/>
              <path d="M11 8.38A2.62 2.62 0 1 0 11 13.62 2.62 2.62 0 0 0 11 8.38Z" fill="currentColor"/>
            </svg>
            Preview
          </button>
        </div>
      </td>
    </tr>
  ))}
</DataTable>
```

**Table Wrapper CSS:**
- **`.tableScroll`** (Scrollable container):
  - `overflow-x: auto`
  - `padding-right: 2px`
  - `scrollbar-color: #9bc9ff transparent`
  - `scrollbar-gutter: stable`
  - `scrollbar-width: thin`
  - **Desktop (min-width: 900px):** `overflow: visible; padding-right: 0`

**Custom Scrollbar Styling:**
```css
.tableScroll::-webkit-scrollbar { height: 8px; width: 8px; }
.tableScroll::-webkit-scrollbar-thumb { background: #9bc9ff; border-radius: 999px; }
.tableScroll::-webkit-scrollbar-track { background: transparent; }
```

**Header Styles (`th`):**
- **File:** `src/components/logs/AccountManagement/AccountManagement.module.css` (lines 153-180)
- **`.tableScroll th`:**
  - `color: rgba(30, 30, 30, .55)`
  - `font-size: 14px`
  - `font-weight: 400`
  - `height: 64px`
  - `line-height: 20px`
  - `padding: 0 16px`
- **`.tableScroll th` (enhanced):**
  - `color: rgba(30, 30, 30, .55)`
  - `font-weight: 700`
  - `line-height: 20px`
- **Column widths:**
  - `th:nth-child(1) { width: 30%; }` (Email)
  - `th:nth-child(2) { width: 15%; }` (Role)
  - `th:nth-child(3) { width: 15%; }` (Department)
  - `th:nth-child(4) { width: 18%; }` (Actions)
  - `th:nth-child(5) { width: 13%; }` (Status)
- **`.tableScroll thead th`:**
  - `box-shadow: 0 1px 0 #edf2f7`
  - `position: sticky`
  - `top: 0`
  - `z-index: 3`

**Row Styles (`tr` / `td`):**
- **`.tableScroll tbody td`:**
  - `height: 93px`
- **`.tableScroll td`:**
  - `color: rgba(30, 30, 30, .55)`
  - `font-size: 14px`
  - `font-weight: 400`
  - `height: 64px`
  - `line-height: 20px`
  - `padding: 0 16px`
- **Email link styling (`.emailLink`):**
  - `color: rgba(30, 30, 30, .55)`
  - `font-size: 14px`
  - `text-decoration: underline`
  - `text-underline-offset: 2px`
- **Department styling (`.department`):**
  - `color: #1e1e1e`
  - `font-size: 12px`
  - `font-weight: 600`
  - `line-height: 16px`

**Status Styles:**
- **`.enabled` and `.disabled`:**
  - `font-size: 12px`
  - `font-weight: 600`
  - `line-height: 16px`
- **`.enabled` (Green "Enabled"):**
  - `color: #10b981`
- **`.disabled` (Red "Disabled/Blocked"):**
  - `color: #ff3830`

**Action Button Styling:**
- **`.rowActions`:**
  - `align-items: center`
  - `display: flex`
  - `flex-wrap: wrap`
  - `gap: 8px`
- **`.actionPill` (Preview button):**
  - `align-items: center`
  - `background: transparent`
  - `border: 0`
  - `border-radius: 0`
  - `color: #0088ff`
  - `cursor: pointer`
  - `display: inline-flex`
  - `font-size: 12px`
  - `font-weight: 700`
  - `gap: 7px`
  - `min-height: 22px`
  - `padding: 0`
  - `transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease`

---

## 4. Dependencies

The Account Management module imports the following reusable UI components from `src/components/ui/`:

### UI Components Used:
- **`ActionResultModal`** - From `@/components/ui/ActionResultModal`
- **`Badge`** - From `@/components/ui/Badge/Badge`
- **`Button`** - From `@/components/ui/Button/Button`
- **`DataTable`** - From `@/components/ui/DataTable/DataTable`
- **`EmptyState`** - From `@/components/ui/EmptyState`
- **`ErrorState`** - From `@/components/ui/ErrorState`
- **`LoadingState`** - From `@/components/ui/LoadingState`
- **`Modal`** - From `@/components/ui/Modal/Modal`
- **`Pagination`** - From `@/components/ui/Pagination/Pagination` (imported as `SharedPagination`)

### DataTable Component Details:
**File:** `src/components/ui/DataTable/DataTable.tsx`

**Structure:**
```tsx
<div className={cn(styles.wrap, className)}>
  <table className={styles.table} style={{ minWidth }}>
    <thead>
      <tr>
        {headers.map((header, index) => (
          <th key={`${header}-${index}`}>{header}</th>
        ))}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
</div>
```

**DataTable CSS (from DataTable.module.css):**
- **`.wrap`**: `overflow-x: auto`
- **`.table`**: 
  - `border-collapse: collapse`
  - `color: #334155`
  - `width: 100%`
- **`.table th, .table td`**:
  - `border-bottom: 1px solid #edf2f7`
  - `font-size: 13px`
  - `padding: 18px`
  - `text-align: left`
- **`.table th`**:
  - `background: #ffffff`
  - `color: #243245`
  - `font-weight: 800`
  - `position: sticky`
  - `top: 0`
  - `z-index: 1`

### Utility Libraries:
- **`cn`** - From `@/lib/cn` (className utility function)
- **`withAuditActor`** - From `@/lib/auditClient` (audit logging)
- **`formatBarangayName`** - From `@/lib/formatters` (text formatting)
- **`queryKeys`** - From `@/lib/queryKeys` (React Query keys)
- **`fetchJson`** - From `@/services/apiClient` (API client)
- **`getAccountUsers`** - From `@/services/logsService` (data service)

---

## 5. Pagination Component

**File:** `src/components/ui/Pagination/Pagination.tsx`

**Usage in Account Management:**
```tsx
<SharedPagination 
  pagination={paginatedUsers.pagination} 
  onPageChange={setPage} 
  label="Account users" 
  compact 
  alwaysVisible 
/>
```

**Pagination Props:**
- `pagination`: PaginationState object with `{ page, limit, total, totalPages }`
- `onPageChange`: Function to handle page changes
- `label`: Accessible label for screen readers
- `compact`: Boolean for compact display mode
- `alwaysVisible`: Boolean to always show pagination

---

## 6. Responsive Design Breakpoints

### Mobile (< 900px):
- **Toolbar:** Single column grid (`grid-template-columns: 1fr`)
- **Table:** Horizontal scroll enabled with custom scrollbar
- **Card:** Flexible height (`min-height: 650px`)

### Desktop (≥ 900px):
- **Toolbar:** 7-column grid layout (`252px 190px 112px 112px 1fr 112px 112px`)
- **Table:** No horizontal scroll (`overflow: visible`)
- **Card:** Fixed height (`height: 650px`)
- **Form Grid:** 2-column layout for form actions

### Mobile (< 520px):
- **Card:** Reduced padding (`padding: 18px`)
- **Modal:** Adjusted width for mobile screens

---

## 7. Key Design Patterns

### Font Family:
- Primary: `"Source Sans Pro", ui-sans-serif, system-ui, sans-serif`
- Applied consistently across all card elements

### Color Palette:
- **Primary Blue:** `#0088ff` (buttons, links, active states)
- **Success Green:** `#10b981` (enabled status)
- **Error Red:** `#ff3830` (disabled/blocked status)
- **Text Colors:** `rgba(30, 30, 30, .55)` (body), `#1e1e1e` (headings)
- **Border Colors:** `#cbd5e1` (inputs, buttons)
- **Background:** `#ffffff` (card, inputs)

### Border Radius:
- **Card:** `14px`
- **Inputs/Buttons:** `10px`
- **Search Icon:** `50%` (circle)

### Box Shadows:
- **Card:** `0 1px 3px rgba(0, 0, 0, .1), 0 1px 2px rgba(0, 0, 0, .1)`
- **Modal:** Complex layered shadows for depth

---

## 8. Implementation Notes

### Table Structure:
- Uses standard HTML `<table>`, `<thead>`, `<tbody>` structure
- Sticky header for large datasets
- Custom scrollbar styling for consistent UX
- Border-bottom dividers between rows (not borders on cells)

### Status Badge Pattern:
- Status is a simple `<span>` with conditional CSS classes
- Green for "active" (`.enabled`)
- Red for "inactive"/"blocked" (`.disabled`)
- Bold text, small font size (12px)

### Action Buttons Pattern:
- Preview button uses `.actionPill` class
- Transparent background with blue text
- Includes SVG icon
- Hover effects with subtle transitions

### Toolbar Layout:
- CSS Grid for responsive layout
- Search input takes significant space (252px on desktop)
- Export and Add buttons are fixed width (100px each)
- Dropdowns are compact (112px on desktop)

---

**Blueprint Status:** ✅ COMPLETE - All structural elements documented for replication  
**Next Steps:** Use this blueprint to implement matching design in target repository  
**Validation:** Blueprint created from READ-ONLY inspection of reference repository
