# Trigger Points: TP1, TP1.5, TP1.7

## TP1: Progress Milestone

**Khi nào:** Milestone xảy ra:
- Chuyển mode: PLANNING → EXECUTION → VERIFICATION
- Gọi `notify_user` (TRƯỚC khi gọi)
- Hoàn thành 1 component/file lớn
- Phát hiện vấn đề cần thay đổi approach

**Action:**
```
symphony_report_progress(
  task_id=current_task,
  progress=estimated_percentage,
  last_action="mô tả ngắn"
)
```

**Progress Guide (Three-Phase Model):**
```
  10% — Task created, đang research/đọc code
  20% — Implementation plan approved
  25% — Phase A done (build OK, dependencies ready)
  30% — Phase B bắt đầu (UI shell coding)
  45% — Phase B done → USER TEST CHECKPOINT #1 (UI review)
  50% — Phase C bắt đầu (logic integration)
  50-85% — Phase C per-feature (each feature = +5-10%)
  85% — Phase C done, đang final verification
  90% — Walkthrough/docs tạo xong
 100% — Hoàn thành (auto-trigger TP2)
```

**Enforcement:**
- ❌ KHÔNG được gọi `notify_user` mà chưa `report_progress` trước đó
- ❌ KHÔNG được chuyển mode (task_boundary) mà chưa report

**Mindful Check (gắn vào TP1):**
```
Nếu mindful_enabled VÀ request là iterate/polish trên feature đã done:
  iteration_map[feature]++
  IF >= iteration_threshold → ⏸️ MINDFUL PAUSE (xem mindful-stop.md)
```

---

## TP1.5: Design Compliance Check (Gate 4 Enforcement)

**Khi nào:** Mỗi khi AI sửa file liên quan đến DB/Model/Schema trong EXECUTION mode.

**Trigger signals:**
```
File patterns:
  - **/models/**,  **/entities/**,  **/schemas/**
  - **Migration*, **Schema*, **Model*
  - *.entity.*, *.model.*, *.schema.*
  - Database.swift, AppDatabase.swift, schema.prisma, etc.
```

**Action:**
```
1. Kiểm tra: docs/architecture/<feature>_design.md tồn tại?
   → KHÔNG → ⚠️ Warning: "Đang sửa model file nhưng chưa có approved design."
     → Nếu COMPLEX task → ⛔ DỪNG, enforce Gate 2
     → Nếu TRIVIAL/MODERATE → Warning only, tiếp tục

2. Đối chiếu thay đổi vs approved design:
   → Thêm field KHÔNG có trong design? → ⛔ DỪNG
   → Đổi type khác design? → ⛔ DỪNG
   → Xóa field trong design? → ⛔ DỪNG
   → Thêm field CÓ trong design? → ✅ OK

3. Khi DỪNG:
   → Thông báo schema change ngoài approved design
   → Kích hoạt spec-gate skill để update design doc
   → Sau khi re-approve → tiếp tục code
```

---

## TP1.7: Flexible Checkpoint (Manual vs Auto)

**Cấu hình Mode Verification:**
- `{"autoVerification": true}` → **Auto Device Checkpoint (ADC)**: Dùng Maestro tự build & chụp screenshot. Tiến thẳng (BlockedOnUser=false).
- `{"autoVerification": false}` (hoặc không khai báo) → **Manual Checkpoint**: Dừng chờ user test (BlockedOnUser=true). **MẶC ĐỊNH an toàn**.

**Khi nào trigger TP1.7:**
1. **Phase B → C Transition (BẮT BUỘC cho COMPLEX):** ALL UI screens đã code xong
2. **Sau mỗi feature trong Phase C (COMPLEX tasks):** Feature X đã code xong logic

**Action (Tùy theo Mode):**
```
1. Report progress trước: symphony_report_progress(current_task, progress)
2. Kiểm tra cờ `autoVerification` trong .project-identity.

=== TRƯỜNG HỢP 1: autoVerification = false (Default Manual) ===
   - Announce "🧪 MANUAL USER TEST CHECKPOINT #{N}"
   - Đưa hướng dẫn test cụ thể
   - Gọi notify_user(BlockedOnUser=true) — DỪNG và CHỜ user response

=== TRƯỜNG HỢP 2: autoVerification = true (Autonomous UI Visual Verification) ===
   AI tự động thực hiện chu trình 5 bước để kiểm tra hiển thị:
   1. [ISOLATION]: Tạm thời chỉnh sửa Entry File (ContentView/MainActivity/App) để boot trực tiếp vào màn hình mục tiêu. Inject mock-data.
   2. [BOOT]: Chạy Auto Build và Launch app lên Simulator/Emulator (hoặc dùng mcp_maestro_launch_app).
   3. [VERIFY]: Call CLI / Maestro take_screenshot. AI gọi `view_file` lên ảnh để đối chiếu vs Thiết kế (Padding, Colors, Text, State).
   4. [MANDATORY REVERT]: BẤT KỂ kết quả ra sao (hay build lỗi), PHẢI gỡ bỏ code Isolation, trả Entry File về phiên bản gốc (dùng Git stash hoặc revert tay).
   5. [FEEDBACK LOOP]:
      - Nếu PASS: BlockedOnUser=false. Lập tức đi tiếp!
      - Nếu FAIL: AI tự log ra file kết quả chẩn đoán lỗi hiển thị -> Tự vòng lại sửa Code -> Start Bước 1. (Tối đa 3 vòng lặp mindful_pause).
```
