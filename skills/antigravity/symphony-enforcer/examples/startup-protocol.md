# STRICT STARTUP PROTOCOL (BẮT BUỘC)

Mỗi khi bắt đầu task code/debug/plan, AI PHẢI đi qua **6 steps tuần tự**.
KHÔNG được bắt đầu work cho đến khi TẤT CẢ steps ✅.

## Step 0.5: Legacy Artifact Cleanup (AUTO)

```
→ Kiểm tra: .symphony/tasks.json tồn tại?
→ CÓ  → ⚠️ CẢNH BÁO: "Legacy tasks.json detected. Symphony uses SQLite DB — this file is stale."
       → Khuyên user xoá: "rm .symphony/tasks.json"
       → KHÔNG tự xoá (safety guardrail) — chỉ cảnh báo.
       → Ghi log vào NeuralMemory: "Legacy tasks.json found at {project}, warned user."
→ KHÔNG → ✅ Clean (no legacy artifacts)
→ Output: "🧹 Step 0.5: Legacy Check ✅ — No stale artifacts"
```

> **Lý do:** Symphony v2+ sử dụng SQLite DB (`symphony.db`) làm single source of truth.
> File `tasks.json` là di sản từ phiên bản cũ (pre-SQLite). Nếu tồn tại song song sẽ gây
> "split-brain" — một nửa tool đọc JSON, một nửa đọc DB → dữ liệu lệch pha.

## Step 1: Project Identity — `.project-identity`

```
→ Kiểm tra: file .project-identity có tồn tại?
→ CÓ  → Đọc projectId, projectName
→ KHÔNG → ⛔ DỪNG. Hỏi user hoặc tạo .project-identity.
→ Output: "📋 Step 1/6: Project Identity ✅ — {projectId}"
```

## Step 2: NeuralMemory Brain — Switch brain

```
→ nmem brain use <projectId>
→ nmem_recap(level=1) — load context
→ Output: "🧠 Step 2/6: Brain ✅ — switched to {projectId}"
```

## Step 3: Spec Alignment — Đọc Project Spec (Kiro + fallback)

```
→ CHECK 1 (Kiro — HIGHEST PRIORITY): .kiro/specs/ tồn tại?
  → CÓ → Load specs từ .kiro/specs/:
     - .kiro/specs/<project>/requirements.md → project spec
     - .kiro/specs/<module>/requirements.md → module specs
     - .kiro/specs/<module>/design.md → architecture
     - .kiro/specs/<module>/tasks.md → task breakdown (cho Step 4)
     → Extract constraints liên quan đến task hiện tại
     → Output: "📐 Step 3/6: Kiro Specs Loaded ✅ — {N} modules, {M} design docs"

→ CHECK 2 (fallback): docs/specs/PROJECT.md tồn tại?
  → CÓ  → Đọc silent: PROJECT.md + TECH-SPEC.md + REQUIREMENTS.md
         → Extract constraints liên quan đến task hiện tại
         → NẾU PLANNING mode:
            - Hỏi user 1-3 câu về constraints/UX cụ thể của feature
  → KHÔNG → Skip (project chưa /init) → "📐 Step 3/6: No spec — skipped"
```

## Step 4: Symphony Task — Tạo hoặc nhận task

```
→ CHECK 1 (Kiro tasks): .kiro/specs/<module>/tasks.md tồn tại?
  → CÓ + chưa import → Parse task items từ tasks.md:
     - Group theo module name
     - Đánh tag kèm module name
     → ⛔ CẢNH BÁO: KHÔNG đồng bộ nhỏ lẻ lên Trello. Chỉ đồng bộ module/feature lớn.
     → Output: "🎯 Step 4/6: Kiro Tasks Imported ✅ — {N} tasks created"
     → Claim task phù hợp nhất với user request

→ CHECK 2 (fallback): symphony_available_tasks(filter="my") → check active tasks
  → CÓ task in_progress phù hợp → dùng tiếp
  → CÓ task ready phù hợp → symphony_claim_task
  → KHÔNG CÓ → symphony_create_task(title) → symphony_claim_task(new_id)
→ Lưu task_id cho TP1-TP4
→ Output: "🎯 Step 4/6: Task ✅ — #sym-XYZ claimed"
```

## Step 5: Confirmation Block

```
🚦 STARTUP PROTOCOL COMPLETE
══════════════════════════════════════
  Step 0.5: 🧹 Legacy Check     ✅  No stale artifacts
  Step 1:   📋 Project Identity  ✅  {projectId}
  Step 2:   🧠 NeuralMemory      ✅  brain: {projectId}
  Step 3:   📐 Spec Alignment     ✅  {constraints_count} constraints loaded
  Step 4:   🎯 Task              ✅  #sym-XYZ — "{title}"
  Step 5:   ✅ READY TO WORK
══════════════════════════════════════
```

> ⛔ **Nếu KHÔNG hiển thị confirmation block = VI PHẠM**
