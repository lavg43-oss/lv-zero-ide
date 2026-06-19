---
name: gitnexus-intelligence
description: >-
  Code intelligence via GitNexus knowledge graph. Auto-triggers on refactoring,
  debugging, impact analysis, pre-commit checks, and codebase exploration.
  Requires project to be indexed with `npx gitnexus analyze`.
metadata:
  stage: core
  version: "1.0"
  tags: [gitnexus, code-intelligence, knowledge-graph, impact-analysis, refactoring]
agent: Orchestrator
trigger: auto
invocation-type: auto
priority: 5
---

<!-- ⚠️ IMPACT-FIRST — PHẢI chạy gitnexus_impact TRƯỚC khi edit symbol. Chưa index → KHÔNG dùng tools. -->

# GitNexus Intelligence v1.0 — Code-Aware Agent Skill

> **Purpose:** Cung cấp architectural awareness cho AI agent thông qua knowledge graph.
> GitNexus index codebase thành graph (symbols, relationships, execution flows),
> expose qua MCP tools để agent hiểu blast radius TRƯỚC khi edit.

---

## ⚡ Prerequisites

```
CHECK: Project đã được index chưa?
  → Tìm thư mục `.gitnexus/` trong project root
  → Hoặc chạy: `npx gitnexus status`

CHƯA INDEX:
  → Gợi ý user: "Project chưa được GitNexus index. Chạy `npx gitnexus analyze` trước nhé."
  → KHÔNG dùng GitNexus tools khi chưa index.

INDEX STALE (tool trả warning):
  → Cảnh báo: "GitNexus index đã cũ. Chạy `npx gitnexus analyze` để cập nhật."
```

---

## 🔑 Auto-Repo Detection Protocol (BẮT BUỘC)

```
TRƯỚC KHI gọi bất kỳ GitNexus MCP tool nào:

1. Gọi gitnexus_list_repos() → lấy danh sách repos đã index
2. Match project directory (từ .project-identity hoặc cwd) với repo paths
3. Dùng matched repo name làm `repo` param cho MỌI tool call

VÍ DỤ:
  gitnexus_list_repos() trả về repo path "/Users/.../FitWitnessSimple"
  → project đang mở = FitWitnessSimple
  → gitnexus_query({query: "weather", repo: "FitWitnessSimple"})

FALLBACK (nếu không match path):
  1. So sánh projectId (từ .project-identity) với repo names
  2. Nếu vẫn không match → hỏi user chọn repo

⚠️ KHÔNG BAO GIỜ gọi GitNexus tool mà THIẾU `repo` param khi có >1 repo indexed.
```

> **Quản lý repos:** `awkit gitnexus list` để xem, `awkit gitnexus clean` để dọn repos cũ.

---

## 🎯 When to Activate

| Trigger | Action |
|---------|--------|
| Trước khi edit bất kỳ function/class/method | `gitnexus_impact` → check blast radius |
| Debug error / trace bug | `gitnexus_query` + `gitnexus_context` |
| Explore unfamiliar code | `CODEBASE.md` + `grep_search` → Tìm Anchor Class → `gitnexus_context` |
| Rename symbol | `gitnexus_rename` (dry_run trước) |
| Trước commit | `gitnexus_detect_changes` |
| Refactor / extract / split | `gitnexus_context` + `gitnexus_impact` |

---

## 🔧 Tools Reference (7 MCP Tools)

| Tool | Purpose | When |
|------|---------|------|
| `gitnexus_query` | Process-grouped hybrid search (BM25 + semantic) | Tìm code theo concept |
| `gitnexus_context` | 360° symbol view: callers, callees, processes | Deep dive vào 1 symbol |
| `gitnexus_impact` | Blast radius analysis: d=1/2/3 with confidence | Trước khi sửa code |
| `gitnexus_detect_changes` | Git-diff impact: mapped to affected processes | Trước commit |
| `gitnexus_rename` | Multi-file coordinated rename via graph | Rename symbols an toàn |
| `gitnexus_cypher` | Raw Cypher graph queries | Custom analysis |
| `gitnexus_list_repos` | List all indexed repositories | Discover repos |

> **Multi-repo:** Khi có nhiều repos indexed, thêm `repo` param: `gitnexus_query({query: "auth", repo: "my-app"})`

---

## 📚 Resources Reference

| Resource | Content | Tokens |
|----------|---------|--------|
| `gitnexus://repos` | All indexed repos | ~50 |
| `gitnexus://repo/{name}/context` | Stats + staleness check | ~150 |
| `gitnexus://repo/{name}/clusters` | Functional areas + cohesion | ~300 |
| `gitnexus://repo/{name}/cluster/{name}` | Area members + files | ~500 |
| `gitnexus://repo/{name}/processes` | All execution flows | ~200 |
| `gitnexus://repo/{name}/process/{name}` | Step-by-step trace | ~200 |
| `gitnexus://repo/{name}/schema` | Graph schema for Cypher | ~200 |

---

## 📋 Workflow: Impact Analysis (Trước khi edit)

```
1. gitnexus_impact({target: "symbolName", direction: "upstream"})
   → Xem ai depend vào symbol này
2. READ gitnexus://repo/{name}/processes
   → Check execution flows bị ảnh hưởng
3. Đánh giá risk level:
   - d=1 → WILL BREAK (direct callers) → PHẢI update
   - d=2 → LIKELY AFFECTED → Nên test
   - d=3 → MAY NEED TESTING → Test nếu critical path
4. Report risk cho user trước khi sửa
```

### Risk Assessment

| Affected | Risk |
|----------|------|
| <5 symbols, ít processes | LOW |
| 5-15 symbols, 2-5 processes | MEDIUM |
| >15 symbols hoặc nhiều processes | HIGH |
| Critical path (auth, payments) | CRITICAL |

---

## 📋 Workflow: Debugging

```
1. gitnexus_query({query: "<error hoặc symptom>"})
   → Tìm execution flows liên quan
2. gitnexus_context({name: "<suspect function>"})
   → Xem callers, callees, process participation
3. READ gitnexus://repo/{name}/process/{processName}
   → Trace full execution flow step-by-step
4. gitnexus_detect_changes({scope: "compare", base_ref: "main"})
   → Nếu là regression: xem branch đã thay đổi gì
```

---

## 📋 Workflow: Exploring Code (Zero-Shotgun Protocol)

```
1. Đọc CODEBASE.md để xác định cấu trúc module / Clean Architecture layers.
2. Dùng list_dir hoặc grep_search vào đúng thư mục dự đoán để tìm 1 "Anchor Class" (VD: ProfileViewModel).
3. KHÔNG dùng gitnexus_query rải rác trừ khi các bước 1-2 hoàn toàn thất bại.
4. Dùng gitnexus_context({name: "<AnchorClass>"}) để lấy 360° view các luồng dữ liệu xung quanh điểm neo này.
5. READ gitnexus://repo/{name}/process/{name} → Full trace luồng thực thi liên quan.
```

---

## 📋 Workflow: Safe Refactoring

### Rename Symbol
```
1. gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})
   → Preview tất cả edits (graph edits = safe, text_search = review)
2. Review kết quả, đặc biệt text_search edits
3. gitnexus_rename({..., dry_run: false})   → Apply
4. gitnexus_detect_changes()                → Verify scope
```

### Extract / Split
```
1. gitnexus_context({name: "target"})       → All incoming/outgoing refs
2. gitnexus_impact({target, direction: "upstream"}) → External callers
3. Plan update order: interfaces → implementations → callers → tests
4. Execute changes
5. gitnexus_detect_changes()                → Verify affected scope
```

---

## 📋 Workflow: Pre-Commit Check

```
1. gitnexus_detect_changes({scope: "staged"})
   → Changed symbols, affected processes, risk level
2. Nếu risk HIGH/CRITICAL → Cảnh báo user
3. Verify tất cả d=1 dependents đã được update
```

---

## 🚫 Rules

```yaml
always_do:
  - PHẢI chạy gitnexus_impact TRƯỚC khi edit bất kỳ symbol nào
  - PHẢI chạy gitnexus_detect_changes TRƯỚC khi commit
  - PHẢI cảnh báo user khi risk = HIGH hoặc CRITICAL
  - PHẢI dùng GitNexus context sau khi xác định được "Anchor Class" qua heuristic search
  - PHẢI dùng gitnexus_rename (dry_run trước) khi rename

never_do:
  - KHÔNG gọi gitnexus_query (>1 lần) với các khái niệm bao quát ("appwrite feedback", "push notification") gây lãng phí token.
  - KHÔNG edit function/class mà chưa check impact
  - KHÔNG ignore HIGH/CRITICAL risk warnings
  - KHÔNG rename bằng find-and-replace → dùng gitnexus_rename
  - KHÔNG commit mà chưa detect_changes
  - KHÔNG dùng GitNexus tools khi project chưa index
```

---

## 🔗 Skill Relationships

```
WORKS WITH:
  orchestrator (Gate 4 — search before building, Layer 0)
  systematic-debugging (bổ sung structural context)
  code-review (pre-commit blast radius check)
  verification-gate (detect_changes = evidence)

DOES NOT:
  Tự index project (user phải chạy npx gitnexus analyze)
  Sửa code trực tiếp (chỉ cung cấp context)
```

---

## 🔍 Graph Schema Reference

**Nodes:** File, Function, Class, Interface, Method, Community, Process

**Edges (CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
-- Find all callers of a function
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath

-- Find what a function calls
MATCH (f:Function {name: "myFunc"})-[:CodeRelation {type: 'CALLS'}]->(callee)
RETURN callee.name, callee.filePath
```

---

*gitnexus-intelligence v1.0 — Code Intelligence for Antigravity*
