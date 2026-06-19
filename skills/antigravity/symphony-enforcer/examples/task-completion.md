# Task Completion Protocol (TP2) + Git Commit (TP2.5) + Auto-Next (TP4)

## TP2: Task Complete — Completion Status Protocol

**Khi nào:** AI detect ≥2/4 completion signals:

```
Signal 1: Final notify_user với BlockedOnUser=false
Signal 2: Walkthrough artifact đã tạo
Signal 3: Tất cả checklist items trong task.md đã [x]
Signal 4: Verification pass (tests OK, build OK)
```

**Completion Status Protocol (4 statuses):**

```
DONE:
  Điều kiện: Verification pass, không caveats.
  Format: "✅ DONE — {summary}. Build: ✅. Tests: ✅ N/N."

DONE_WITH_CONCERNS:
  Điều kiện: Code hoạt động nhưng có caveats/risks.
  Format: "⚠️ DONE_WITH_CONCERNS — {summary}.
    Concerns: [list]  Risk: [mức độ]  Recommendation: [đề xuất]"

BLOCKED:
  Điều kiện: Không thể tiếp tục vì external dependency.
  Format: "🚫 BLOCKED — {reason}. Attempted: [list] Needs: [what]"

NEEDS_CONTEXT:
  Điều kiện: Thiếu thông tin từ user.
  Format: "❓ NEEDS_CONTEXT — {what's missing}. Question: [câu hỏi]"
```

⛔ **KHÔNG BAO GIỜ report DONE nếu thực tế là DONE_WITH_CONCERNS hoặc BLOCKED.**

**Action (cho DONE status):**
```
0. ⚡ VERIFICATION GATE (BẮT BUỘC):
   - IDENTIFY → RUN → READ → VERIFY
   - If NO → FIX trước, KHÔNG complete task
   - If YES → Proceed with evidence

1. symphony_complete_task(task_id, summary="STATUS + EVIDENCE")
2. Hiển thị: "✅ SYM #sym-XYZ — {STATUS}"
3. → TRIGGER TP2.5 (Atomic Git Commit)
4. → TRIGGER TP4 (Auto-Next) NGAY LẬP TỨC
```

---

## TP2.5: Atomic Git Commit (BẮT BUỘC)

**Khi nào:** Ngay sau TP2 (task done), TRƯỚC TP4. Chỉ trigger khi có code changes.

**Action:**
```
1. git status --porcelain → KHÔNG CÓ changes → skip
2. Xác định commit type: feat | fix | refactor | docs
3. Format: "{type}({scope}): {task_summary}"
4. git add <files> → git commit -m "{message}"
5. ⚠️ KHÔNG AUTO-PUSH — chỉ commit local
```

**Enforcement:**
- ❌ KHÔNG auto-push
- ❌ KHÔNG commit nếu có unresolved merge conflicts
- ❌ KHÔNG commit files ngoài scope task
- ✅ Mỗi task = 1 commit (atomic, traceable)

---

## TP3: Abandoned / Context Switch

**Khi nào:** User đổi topic, AI timeout, user nói dừng.

**Action:** `symphony_abandon_task(task_id, reason="...")`

---

## TP4: Auto-Next Suggestion (BẮT BUỘC)

**Khi nào:** Ngay sau TP2 (task completed). KHÔNG ĐƯỢC BỎ QUA.

**Action:**
```
1. ĐỌC projectId từ .project-identity
2. symphony task list -P <projectId> -s ready (CHỈ tasks cùng project)
   ⚠️ TUYỆT ĐỐI KHÔNG dùng filter="ready" không có project filter
3. Lọc top 2-3 ready tasks theo priority
4. Kiểm tra Mindful Rest trigger:
   IF mindful_enabled VÀ milestone_rest VÀ (tasks_completed >= 3 OR vừa xong Phase C / Gate 5):
     → Hiển thị REST option TRƯỚC danh sách tasks:
       🧘 Đề xuất: Dừng phiên tại đây.
          Bạn đã hoàn thành {tasks_completed} tasks hôm nay.
          Commit, nghỉ ngơi, quay lại phiên mới sau.
       ─────────────
       Hoặc tiếp tục:
5. Present cho user:
   ➡️ NEXT STEPS ({projectName})
   📋 #sym-A1 — Auth Module (P0, ready)
   📋 #sym-A2 — Dashboard UI (P1, ready)
6. Nếu KHÔNG CÓ ready tasks → "✨ Không còn task ready! Tạo task mới hoặc chuyển phase."
```

**Enforcement:**
- ❌ KHÔNG kết thúc conversation mà KHÔNG present next suggestion
- ❌ KHÔNG show tasks từ project khác
- ❌ KHÔNG bỏ qua Mindful Rest khi trigger conditions đạt (nếu enabled)
