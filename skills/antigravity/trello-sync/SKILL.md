---
name: trello-sync
description: |
  Hệ thống đồng bộ tiến độ dự án lên Trello sử dụng Trello CLI (v1.5+) + REST API.
  Mỗi dự án = 1 Trello Card. Tiến độ được theo dõi qua Checklists và Comments.
  AI tự động thêm/đánh dấu checklist items khi hoàn thành task.
metadata:
  stage: core
  version: "3.0"
  tags: [trello, sync, project-management, tracking, agile]
agent: Trello Sync Agent
allowed-tools:
  - run_command
trigger: always
invocation-type: auto
priority: 2
---

# Trello Sync v3.0 — Project-Per-Card Protocol

> **Purpose:** Tự động đồng bộ tiến độ dự án lên Trello card tương ứng, giúp team (PM, QC, Dev) theo dõi realtime.
> **Model:** 1 Card = 1 Dự án. Checklist Items = tasks/features. Comments = milestones.
> **Tools:** `trello-cli v1.5` (CLI) + Trello REST API (curl) cho checklist items.

---

## ⚠️ Core Rules

```text
KHÔNG CÓ NGOẠI LỆ:
- 1 Dự án = 1 Trello Card (KHÔNG tạo card mới cho mỗi task).
- **Mô tả Card (Description)** BẮT BUỘC phải được update chứa cái nhìn tổng thể về dự án (Mục tiêu, Tech Stack, Tình trạng chung) để Quản lý dễ nắm bắt.
- **Trello (PM View) vs Kiro (Dev View):** Trello là màn hình dành cho Quản lý (PM, QC), còn `.kiro/specs/tasks.md` hay `task.md` là nơi để AI/Dev làm việc.
- [QUAN TRỌNG NHẤT VỀ ĐỘ CHI TIẾT (GRANULARITY)]: Khi được yêu cầu chia task để sync lên Trello, AI PHẢI CHIA NHỎ các phase/tính năng lớn ra thành các Sub-features / Điểm chạm nghiệp vụ (Medium-detail). CẤM làm task quá chung chung.
  - BAD (Quá chung chung): "Hoàn thiện Launch", "Setup Thanh Toán", "Xử lý Logic".
  - BAD (Quá chi tiết / Dev task): "Tạo file BillingManager.kt", "Sửa padding cho nút Share".
  - GOOD (Chuẩn PM View): "Tích hợp Google Play Billing v7", "Xử lý AlarmManager nhắc nhở đo huyết áp", "Cài đặt Crashlytics", "Thiết kế Store Assets (Icon, Screenshots)".
- AI NÊN gom nhóm các Items vào thành nhiều Checklist rõ ràng theo từng phân khu lớn (VD: `Checklist: 1. Hoàn Thiện Logic`, `Checklist: 2. Monetization`, `Checklist: 3. Analytics & QA`).
- ⛔ TUYỆT ĐỐI CẤM đưa các GIAI ĐOẠN QUY TRÌNH (Process Gates) vào Checklist Items. KHÔNG CÓ CÁC MỤC NHƯ: "Tài liệu", "Thiết kế Giao diện", "Gate 1", "Phase 2".
- Progress qua các Gate (Gate 1, Gate 2...) CHỈ ĐƯỢC BÁO CÁO qua Comment. Quản lý không quan tâm AI đang ở Gate nào trên Checklists.
- BẮT BUỘC ĐỒNG BỘ TOÀN BỘ DANH SÁCH NGHIỆP VỤ TỔNG HỢP: Khi Spec/dự án đã hòm hòm, AI phân mảnh các scope thành các Checklist Items (như quy tắc Granularity ở trên).
- Comment ở milestone quan trọng PHẢI bao gồm các quyết định cốt lõi hoặc sự thay đổi phase (VD: "Đã thiết kế xong màn hình Home", "Bắt đầu code Logic tracking").
```

---

## 🔐 Auth & Config

Credentials được lưu dưới dạng **environment variables** (`TRELLO_KEY`, `TRELLO_TOKEN`) trong shell profile (`~/.zshrc` hoặc `~/.bashrc`). Cấu hình dự án (Board/List/Card) lưu trong `"trello"` key của `.project-identity` ở root mỗi dự án (fallback: `.trello-config.json`).

### 1. Global Credentials (Environment Variables)

User setup lần đầu qua **interactive wizard** khi chạy `awkit init`:
- CLI tự hỏi API Key → tạo link authorize token → hỏi Token → lưu vào `~/.zshrc`.
- Nếu user đã setup rồi, CLI tự skip bước này.

### 2. Local Project Config (`"trello"` key trong `.project-identity`)
```json
{
  "projectName": "MyApp",
  "projectId": "myapp",
  "trello": {
    "board": "Appdexter - Code Magic",
    "list": "Kiên",
    "card": "Tên Card Dự Án"
  }
}
```

> **Fallback:** Nếu `.project-identity` không có key `trello`, CLI sẽ thử đọc `.trello-config.json` (backward compat).

| Field | Mô tả |
|-------|--------|
| `board` | Tên board (TÊN, không dùng ID) |
| `list` | Tên list chứa card (= team member đang phụ trách) |
| `card` | Tên card dự án (phải khớp chính xác trên Trello) |

### 🔄 Credential Auto-Recovery (BẮT BUỘC cho AI)

Khi `awkit trello` báo **"Trello credentials not found"**, AI PHẢI thực hiện:

```text
Lần 1: chạy `source ~/.zshrc` → retry lệnh awkit trello
Lần 2: chạy `source ~/.zshrc` → retry lệnh awkit trello
Lần 3 (vẫn lỗi): báo user "Trello chưa được cấu hình. Vui lòng chạy awkit init để setup lại."
```

> ⚠️ KHÔNG được tự tạo script, tự inject biến, hay tự sửa file `.zshrc`. CHỈ dùng `source` và `awkit init`.

### Tự Động Hóa Qua `awkit trello` (BẮT BUỘC)

AI không cần tự inject ENV hay tìm kiếm cấu hình. Công cụ lệnh `awkit trello` v1.3.0+ sẽ TỰ ĐỘNG đọc từ env vars và `.project-identity`. MỌI thao tác Trello phải đi qua `awkit trello`.

> **Proactive Auto-Sync Rule:** Nếu `.project-identity` có `automation.trello.autoSync: true`, AI **BẮT BUỘC** tự động gọi lệnh Trello tại các trigger points mà không cần user yêu cầu:
> - Từng task complete → `awkit trello complete "<tên>"` + comment progress.
> - Đạt milestone (chuyển Gate, đạt 40/60/80%) → `awkit trello comment`.
> - Gặp lỗi Blocked → `awkit trello block`.
> *(Nếu `autoSync: false` hoặc không có config, AI tiếp tục chế độ bị động).*

---

## 📚 Command Reference

### AWKit Trello CLI (Native, Zero Config Needed in Bash)

Công cụ `awkit` đã cung cấp sẵn các lệnh native quản lý Trello. Phải ƯU TIÊN SỬ DỤNG.

| Action | Command |
|--------|---------|
| Cập nhật mô tả (desc) | `awkit trello desc "<text>"` |
| Comment milestone | `awkit trello comment "<text>"` |
| Thêm checklist item | `awkit trello item "<name>"` |
| Check ✅ hoàn thành | `awkit trello complete "<name>"` |
| Báo Blocked / Lỗi | `awkit trello block "<reason>"` |
| Tạo checklist mới | `awkit trello checklist "<name>"` |

> 💡 Nếu gặp board/list/card "not found", cấu hình có thể sai, báo user kiểm tra lại `trello` key trong `.project-identity`.

---

## 🔄 Lifecycle & Trigger Points

### Board Structure (Context)

```
Board: Appdexter - Code Magic
├── App cần làm ☘️     ← Backlog (ý tưởng)
├── Kiên               ← Cards = projects assigned to Kiên
├── Huy lớn            ← Cards = projects assigned to Huy lớn
├── Doing              ← Cards actively being worked on
├── Done               ← Completed cards
└── ...
```

Mỗi Card chứa:
- **Description**: Mô tả dự án, link repo
- **Checklists**: Các phase (UI, Code Logic, Infrastructure...)
- **Checklist Items**: Tasks cụ thể trong phase đó

---

### ⚡ Delegation Rule: Khi nào dùng CLI, khi nào tự xử lý

> [!IMPORTANT]
> Gemini/Codex CLI đã có sẵn skill trello-sync. Chỉ delegate cho CLI khi **tác vụ NẶNG** (nhiều bước, cần phân tích). Tác vụ đơn giản thì Antigravity tự gọi `awkit trello` trực tiếp — tránh xử lý 2 lần.

| Loại tác vụ | Xử lý | Lý do |
|-------------|--------|-------|
| 🔴 **Nặng** — Setup project, tạo nhiều checklists, sync toàn bộ spec | `gemini -p "..." --approval-mode auto` | Nhiều bước, cần phân tích spec → delegate |
| 🟢 **Nhẹ** — Add 1 item, complete 1 item, comment, block | `awkit trello <cmd>` trực tiếp | 1 lệnh duy nhất → tự gọi, không cần CLI |

---

### TP1: 🚀 Start Task / Start Project (Description + Checklist) — 🔴 DELEGATE

**Khi nào:** AI bắt đầu project mới, hoặc chuẩn bị triển khai Specs đã chốt (Gate 3/Gate 4).
*(Lưu ý: Không tạo Checklist Items các phase "Gate 1", "Gate 2" - lúc này chỉ dùng Comment hoặc Update Description thôi).*

**Action:** Delegate cho **Gemini CLI** (nhiều bước: update desc + tạo checklists + thêm items + comment):
```bash
gemini -p "Phân tích Spec/thiết kế đã chốt của dự án. Tạo các checklists và checklist items trên Trello card theo quy tắc Granularity (PM View). Cập nhật description card với tổng quan dự án. Comment thông báo bắt đầu. Dùng awkit trello." --approval-mode auto
```

---

### TP2: 📈 Report Progress (Comment Milestone) — 🟢 TRỰC TIẾP

**Khi nào:** AI đạt milestone quan trọng (40%, 60%, 80%) hoặc hoàn thành cụm tính năng.

**Action:** Gọi trực tiếp (1 lệnh duy nhất):
```bash
awkit trello comment "⏳ Progress: [Tính năng] ([X]%) — [Chi tiết kỹ thuật]. Symphony: #sym-XXX"
```

---

### TP3: 🛑 Blocked — 🟢 TRỰC TIẾP

**Khi nào:** Task bị chặn, cần human input.

**Action:** Gọi trực tiếp:
```bash
awkit trello block "[Lý do block chi tiết]"
```

---

### TP4: ✅ Task Done (Đánh dấu Item Complete) — 🟢 TRỰC TIẾP

**Khi nào:** Toàn bộ cụm Tính năng Nghiệp vụ đã hoàn thành và sẵn sàng test.
*(Lưu ý: Không check item nếu chỉ mới xong 1 task code con)*

**Action:** Gọi trực tiếp:
```bash
awkit trello complete "[Tên tính năng]"
awkit trello comment "✅ DONE: [Tên tính năng] | Commit: #$(git rev-parse --short HEAD)"
```

---

## 🔗 Symphony Integration (NGUYÊN TẮC: Nhiều Task Code -> 1 Trello Feature)

⚠️ **CHÚ Ý CỰC KỲ QUAN TRỌNG:** KHÔNG MAP 1:1 TỪ SYMPHONY SANG TRELLO CHECKLIST!
Trong Symphony có thể có 50 task nhỏ (VD: Tạo View, Viết API, Sửa CSS). Trello chỉ có 5 Checklist Items lớn (VD: Chức năng Đăng nhập, Profile, Thanh toán). 
Do đó: **CẤM** gọi `awkit trello item` mỗi khi claim 1 task con từ Symphony. Nếu làm vậy Trello sẽ biến thành bãi rác toàn các task code lặt vặt.

**Cách Sync Đúng:**
- Thiết lập Checklist Items ngay từ đầu dựa trên Spec tổng.
- Khi code từng phân hệ con, ĐỪNG sinh ra checklist mới.

| Symphony Event | Trello Action |
|----------------|---------------|
| `symphony_claim_task` | **CHỈ** Comment báo tiến độ: "Đang xử lý code: [Task]..." |
| `symphony_report_progress` | Comment milestone |
| Task BLOCKED | Label "Blocked" + Comment |
| `symphony_complete_task` | **CHỈ** Comment: "Xong code task [Task]." *(Tùy chọn: nếu feature lớn xong 100%, mới call `complete` cho item chính)* |

Trong comment, **PHẢI** ghi Symphony Task ID: `Symphony: #sym-XXX`

---

## 🎯 Best Practices

1. **Checklist naming (Module/Epic)**: Tên checklist thể hiện mảng Tính năng/Module lớn (VD: "Module: Authentication", "Sprint: Workout Tính năng cốt lõi").
   ⛔ KHÔNG ĐẶT theo quy trình AI như "Gate 1", "Phase: Setup", "Giai đoạn Design".
2. **Item naming (Product Features)**: Tên item là tính năng/màn hình cụ thể (VD: "Google Sign-In", "Màn hình Thông kê Calorie", "Chức năng AI tư vấn thực đơn"). 
   ⛔ KHÔNG ĐẶT kiểu "Tài liệu Specs", "Code Scaffolding", "Sửa CSS" hay "Tạo file ABC".
3. **Minimizing noise**: Cập nhật milestone (chuyển gate, chuyển phase) qua **Comment** trên Card, KHÔNG GHI THÀNH **Checklist item** (vốn dĩ checklist item là thứ bàn giao được cho user). Cấm bulk-sync từ `tasks.md`.
4. **Graceful degradation**: CLI/API lỗi → log warning, KHÔNG block code flow.
5. **Dùng lệnh Native**: Luôn luôn gọi `awkit trello <lệnh>` thay vì `trello-cli` thủ công.
6. **Card KHÔNG di chuyển**: Card nằm cố định trong list team member. KHÔNG move card.

---

## Edge Cases

| Tình huống | Xử lý |
|-----------|--------|
| Trello config not found | ⛔ Bỏ qua Trello sync, log cảnh báo, tiếp tục code |
| **Credentials not found** | `source ~/.zshrc` → retry (max 2 lần). Vẫn lỗi → báo user chạy `awkit init` |
| Card not found | Chạy `sync`, retry. Nếu vẫn lỗi → báo user |
| Checklist chưa có | Tạo checklist mới bằng `awkit trello checklist` |
| Item trùng tên | Dùng `card:checklists` kiểm tra trước khi thêm |
| Rate limit / API error | Log warning, tiếp tục code, KHÔNG block flow. CLI tự retry 429. |
| Token hết hạn | Báo user chạy `awkit init` để setup lại credential mới |
| Dự án chưa có card trên Trello | Báo user tạo card trên board, cập nhật `trello` trong `.project-identity` |

---

## Learnings

- Board "Appdexter - Code Magic": Lists = team members, Cards = projects
- Tool native CLI `awkit trello` cho phép update thông tin dự án thẳng từ CLI mà không cần inject variables lằng nhằng.
- KHÔNG sinh script file mồ côi `trello_sync_kiro.py` — phải chạy trực tiếp qua `awkit trello`
