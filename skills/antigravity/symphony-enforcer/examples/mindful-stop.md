# Mindful Stop Protocol — Detailed Logic

> **Purpose:** Chống vòng xoáy tối ưu không hồi kết ("AI brain fry").
> **Design:** Default-ON trong GEMINI.md, enforcement gắn vào TP1/TP2/TP4.
> **Opt-out:** `.project-identity` → `mindfulCheckpoint: false`.

## Gate Check (Init Chain Cache)

```
Trong awf-session-restore, khi đọc .project-identity:
  → Cache mindful config vào session state:
    mindful_enabled = .mindfulCheckpoint ?? true
    iteration_threshold = .mindfulCheckpointConfig?.iterationThreshold ?? 3
    scope_guard = .mindfulCheckpointConfig?.scopeGuard ?? true
    milestone_rest = .mindfulCheckpointConfig?.milestoneRest ?? true

Nếu .project-identity không tồn tại → dùng defaults (tất cả ON)
```

---

## Session State Tracking

```
AI duy trì state xuyên suốt session:
  iteration_map = {}       # feature_name → count
  tasks_completed = 0      # count tasks done trong session
  last_gate_completed = "" # "phase_c" | "gate_5" | ""
```

---

## TP-ITER: Iteration Counter

**Gắn vào:** TP1 (Progress Milestone) — mỗi lần report progress

**Trigger:** User request chứa keywords refactor/polish/optimize TRÊN feature đã hoàn thành

```
IF NOT mindful_enabled → SKIP

Khi nhận request iterate trên feature X:
  iteration_map[X] = (iteration_map[X] ?? 0) + 1

  IF iteration_map[X] >= iteration_threshold:
    ⏸️ MINDFUL PAUSE
    ──────────────────────────────────────
    Cảnh báo: "⏸️ Đã iterate {N} lần trên [{feature}].
    Code đang hoạt động ổn định. Đề xuất:
    1. Commit code hiện tại
    2. Trải nghiệm thực tế trên device/production
    3. Quay lại sau nếu phát hiện vấn đề cụ thể"
    ──────────────────────────────────────

    User response:
      "tiếp tục" / "tôi hiểu, tiếp" / "override" → reset iteration_map[X] = 0, proceed
      Bất kỳ response khác → commit + dừng feature đó
```

---

## TP-SCOPE: Scope Guard

**Gắn vào:** Trước khi bắt đầu EXECUTION — khi nhận request mới

**Trigger keywords:** `[polish, optimize, refine, tối ưu, cải thiện, tweak, mượt hơn, đẹp hơn, smooth, better]`

```
IF NOT mindful_enabled OR NOT scope_guard → SKIP

Khi nhận request chứa trigger keyword:
  Hỏi: "Thay đổi này giải quyết vấn đề cụ thể nào đang gặp trên device/production?
         Hay đây là tối ưu phòng ngừa?"

  User response:
    Nêu vấn đề cụ thể (lỗi, lag, UX problem) → proceed bình thường
    Không rõ / "muốn đẹp hơn thôi" → Đề xuất:
      "📋 Bookmark vào Symphony backlog (P2):
       symphony task create 'Optimize: {description}' --priority 2
       Quay lại khi có feedback từ real users."
```

---

## TP-REST: Milestone Rest Gate

**Gắn vào:** TP4 (Auto-Next Suggestion) — sau khi task complete

**Trigger conditions (BẤT KỲ 1):**
1. `tasks_completed >= 3` trong session hiện tại
2. `last_gate_completed` = "phase_c" hoặc "gate_5"

```
IF NOT mindful_enabled OR NOT milestone_rest → SKIP (TP4 chạy như cũ)

Khi trigger:
  TP4 output THAY ĐỔI thành:

  ➡️ NEXT STEPS ({projectName})
  ──────────────────────────────────────
  🧘 Đề xuất: Dừng phiên tại đây.
     Bạn đã hoàn thành {tasks_completed} tasks hôm nay.
     Tiến độ project: {X}% → {Y}%
     Commit, nghỉ ngơi, quay lại phiên mới sau.
  ──────────────────────────────────────
  Hoặc tiếp tục:
  📋 #sym-A1 — Task Name (P0, ready)
  📋 #sym-A2 — Task Name (P1, ready)

  → 🧘 REST option hiển thị TRƯỚC danh sách tasks
  → User vẫn có thể chọn task để tiếp tục
```

---

## Enforcement Matrix

| Mechanism | Gắn vào TP | Mandatory? | Opt-out key |
|:---|:---|:---|:---|
| Iteration Counter | TP1 | ✅ (khi enabled) | `mindfulCheckpoint: false` |
| Scope Guard | Pre-EXECUTION | ✅ (khi enabled) | `scopeGuard: false` |
| Milestone Rest | TP4 | ✅ (khi enabled) | `milestoneRest: false` |

## .project-identity Config

```json
{
  "mindfulCheckpoint": true,
  "mindfulCheckpointConfig": {
    "iterationThreshold": 3,
    "scopeGuard": true,
    "milestoneRest": true
  }
}
```

| Giá trị | Hành vi |
|:---|:---|
| Không khai báo | = `true` (an toàn mặc định) |
| `true` | Bật toàn bộ, dùng defaults hoặc sub-config |
| `false` | Tắt hoàn toàn, AI chạy full speed |
