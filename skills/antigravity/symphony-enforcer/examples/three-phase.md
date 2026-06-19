# Three-Phase Auto-Enforcement Protocol (BẮT BUỘC)

> **Vấn đề:** AI không tự chủ động dùng Three-Phase nếu không bị ép.
> **Giải pháp:** Auto-detect + auto-announce + auto-enforce.

## Phase State Tracking

AI PHẢI duy trì trạng thái phase hiện tại xuyên suốt Gate 4:

```
current_phase = "A" | "B" | "C" | "none"
phase_b_confirmed = false | true
checkpoint_count = 0
```

## Auto-Detection: Khi nào kích hoạt Three-Phase?

Tại đầu Gate 4 (EXECUTION bắt đầu), AI PHẢI tự kiểm tra:

```
1. Task được triage là COMPLEX?
2. Task có UI component? (detect qua):
   → Symphony task title chứa: screen, view, UI, layout, dashboard, form
   → Implementation plan mentions: Composable, Fragment, Activity, Screen, View
   → Design doc tồn tại (docs/design/ hoặc docs/architecture/ có UI sections)
   → Spec references: wireframe, mockup, screenshot
   → Platform: Android/iOS/React Native/Flutter (hầu hết có UI)

Nếu CẢ HAI điều kiện thỏa:
   → BẮT BUỘC kích hoạt Three-Phase
   → Hiển thị Phase Announcement Block
```

## Phase Announcement Block (BẮT BUỘC)

Khi kích hoạt Three-Phase, AI PHẢI hiển thị:

```
🎯 THREE-PHASE EXECUTION ACTIVATED
══════════════════════════════════════
🏗️ Phase A: Infrastructure Setup
   → {list tasks for Phase A}
🎨 Phase B: UI Shell (Mock Data)
   → {list tasks for Phase B}
   → 🧪 AUTO DEVICE TEST (Maestro) sau phase này
⚡ Phase C: Logic Integration
   → {list tasks for Phase C}
   → 🧪 AUTO DEVICE TEST (Maestro) mỗi feature
══════════════════════════════════════
Bắt đầu Phase A...
```

## Phase Transition Triggers (TỰ ĐỘNG)

```yaml
auto_triggers:
  phase_a_to_b:
    signal: Tất cả [INFRA] tasks đã done + build OK
    action: |
      - Announce: "🏗️ Phase A ✅ — Build thành công. Chuyển sang Phase B (UI Shell)."
      - Set current_phase = "B"
      - Bắt đầu code UI tasks

  phase_b_to_checkpoint:
    signal: Tất cả [UI] tasks đã done
    action: |
      - ⛔ TRIGGER TP1.7 (Checkpoint)
      - Đọc `.project-identity` -> `automation.autoQA`
      - NẾU `true` (Autonomous Dev-QA Loop): 
        + Tự start App / render ngầm Component.
        + Tự động gọi `take_screenshot` (Maestro/CLI).
        + TỰ CHẨN ĐOÁN (Vision Analysis): AI tự đối chiếu file ảnh với Specs/Thiết kế/Code.
        + NẾU Fail -> Tự tạo sub-task sửa code Layout, build lại (Max 3 lần theo `maxSelfCorrectionLoops`).
        + NẾU Pass (hoặc đã ráng hết 3 lần) -> In log báo cáo kèm Ảnh Screenshot ("✅ Phase B UI Verified bằng AI").
        + TỰ ĐỘNG CHUYỂN SANG PHASE C (Không chờ phản hồi - BlockedOnUser=false).
      - NẾU `false` (Manual mode):
        + DỪNG VÀ CHỜ user test thủ công (notify_user BlockedOnUser=true)
        + CHỜ user xác nhận "Duyệt/OK" mới đi tiếp Phase C

  checkpoint_to_phase_c:
    signal: UI tự verify pass (autoQA=true) HOẶC User confirmed "OK" (autoQA=false)
    action: |
      - Set phase_b_confirmed = true
      - Set current_phase = "C"
      - Announce: "🎨 Phase B ✅ — UI đã chốt. Chuyển sang Phase C (Logic)."

  phase_c_per_feature:
    signal: 1 feature [LOGIC] đã done + có UI impact
    action: |
      - TRIGGER TP1.7 (mini checkpoint)
      - Đọc `.project-identity` -> `automation.autoQA`
      - NẾU `true`:
        + Chạy Auto Build -> NẾU Exit code = 0.
        + Dùng Maestro MCP chạy script test cơ bản (Tap -> Input -> Cào View Hierarchy).
        + NẾU không Crash & Dữ liệu đúng -> Pass (Tự đánh dấu Task Done và Commit mà không chặn).
        + NẾU Crash / Lỗi ko tự sửa được -> Dừng, thông báo User.
      - NẾU `false`: Batch các features nhỏ lại để User tự test bộ.
```

## Enforcement Rules

```
❌ VI PHẠM NẶNG:
  - Code logic (Phase C) khi phase_b_confirmed = false
  - Skip Phase Announcement Block
  - Bỏ qua TP1.7
  - Chạy Auto-verification khi `autoVerification: false`
  - Chờ user test thủ công khi `autoVerification: true`

✅ BẮT BUỘC:
  - Luôn announce phase transition rõ ràng
  - Luôn đọc `autoVerification` trong `.project-identity` trước khi trigger check
  - Gắn BlockedOnUser = true cho mode manual, false cho mode auto
  - Ghi lại phase state vào NeuralMemory khi chuyển phase
```
