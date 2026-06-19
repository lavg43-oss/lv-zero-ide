# Architecture Design Templates & Review Protocol

## Data Model Template

```
Cho MỖI entity phát hiện từ spec:

TABLE/COLLECTION: <name>
├── Fields:
│   ├── id: <type> (PK)
│   ├── field_1: <type> [NOT NULL | OPTIONAL]
│   ├── field_2: <type> [DEFAULT: <value>]
│   └── ...
├── Indexes:
│   ├── idx_<name>_<field> (purpose)
│   └── ...
├── Relationships:
│   ├── belongs_to: <table> (FK: <field>)
│   └── has_many: <table>
└── Constraints:
    ├── UNIQUE: <fields>
    └── CHECK: <condition>
```

## API Contract Template

```
ENDPOINT: [METHOD] /api/<path>
├── Purpose: <mô tả ngắn>
├── Auth: <required | optional | public>
├── Request:
│   ├── Headers: <required headers>
│   ├── Params: <path/query params>
│   └── Body: { field: type, ... }
├── Response:
│   ├── 200: { field: type, ... }
│   ├── 400: { error: "validation message" }
│   └── 500: { error: "server error" }
└── Notes: <edge cases, rate limiting, etc.>
```

## State Machine Template

```
STATE MACHINE: <name>
  [initial] → [state_1] → [state_2] → [final]
       ↓           ↓
    [error]    [cancelled]

Transitions:
  initial → state_1: trigger=<event>, guard=<condition>
  state_1 → state_2: trigger=<event>
  any → cancelled: trigger=user_cancel
```

## Self-Review Checklist

```yaml
checklist:
  data_integrity:
    - [ ] Mọi entity có Primary Key?
    - [ ] Foreign Keys đúng direction?
    - [ ] Không có circular dependencies?
    - [ ] Cascade delete rules đã define?
  performance:
    - [ ] Indexes cho frequent queries?
    - [ ] N+1 query potential identified?
    - [ ] Pagination strategy cho list endpoints?
  consistency:
    - [ ] Chuẩn với .project-identity tech stack?
    - [ ] Naming convention thống nhất?
    - [ ] Date/time format thống nhất?
  edge_cases:
    - [ ] Concurrent access handling?
    - [ ] Null/empty value handling?
    - [ ] Soft delete vs hard delete?
    - [ ] Offline-first sync strategy (nếu mobile)?
  security:
    - [ ] PII data identified + encrypted?
    - [ ] Auth rules per endpoint?
    - [ ] Input validation cho mọi user input?
```

## Multi-Role Architecture Review

5 vai trò chuyên sâu để soát lỗi:
1. **DBA:** Index? Normalize? N+1?
2. **Backend Lead:** Reusable? Rate limit? Transaction boundaries?
3. **Security Officer:** SQL Injection? Encrypt at rest/in transit? RBAC?
4. **QA Automation:** Test data setup? Mock API/DB?
5. **SRE/DevOps:** Scale? Migration downtime?

If P0/P1 issues → fix draft before presenting to user.
