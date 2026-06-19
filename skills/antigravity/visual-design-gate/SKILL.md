---
name: visual-design-gate
description: >-
  Gate 2.5 — Visual Design & UI Sync Gate. Thống nhất cách hiểu về UI/UX giữa
  người dùng và AI thông qua phác thảo bằng Pencil MCP Server, hoặc thông qua 
  hình ảnh screenshot/design có sẵn. Đảm bảo UI/UX đã được chốt trước khi chia 
  Symphony tasks và viết code.
metadata:
  stage: core
  version: "1.0"
  tags: [gate, ui, ux, design, pencil, visual, sync, core]
  requires: orchestrator
agent: UI/UX Designer
trigger: conditional
invocation-type: auto
priority: 2.5
activation_keywords:
  - "thiết kế giao diện"
  - "vẽ UI"
  - "phác thảo màn hình"
  - "design ui"
  - "pencil"
---

<!-- ⚠️ GATE 2.5 — Không code UI khi chưa có design approval. Backend-only tasks SKIP gate này. -->

# Visual Design Gate v1.0 (Gate 2.5) — UI/UX Sync Gate

> **Purpose:** Giúp AI và người dùng đồng bộ cách hiểu về ý tưởng giao diện (UI/UX)
> TRƯỚC KHI chia tasks và bắt tay vào code. Sử dụng công cụ Pencil để vẽ preview, 
> hoặc sử dụng mockups/screenshots do người dùng cung cấp sẵn để làm căn cứ.
>
> **Problem it solves:** "Code xong giao diện không ra gì, hoặc chệch hướng so với ý tưởng UI của user"

---

## ⚠️ SCOPE CLARITY

| Skill này LÀM | Skill này KHÔNG làm |
|---------------|---------------------|
| Dùng `pencil` MCP server để phác thảo file `.pen` | Viết code React/Swift/Compose UI |
| Đọc hiểu ảnh đính kèm từ `docs/design` hoặc `docs/screenshot` | Nhận diện DB Schema (việc của spec-gate) |
| Tương tác với user để chốt màu sắc, bố cục, fonts | Quản lý logic back-end |
| Giới thiệu user về Pencil tool nếu project cần thiết kế mới | Phân chia task Symphony |

---

## 🚀 ACTIVATION

Skill này được kích hoạt bởi:
1. **Orchestrator auto-trigger:** Khi Gate 2.5 check FAIL (feature có giao diện nhưng thiếu preview chốt UI, hoặc chưa có design image).
2. **Explicit command:** `/design-ui` hoặc `/visual-sync`
3. **Keyword trigger:** "thiết kế giao diện", "design ui bằng pencil", "phác thảo ui"

---

## 📋 INPUT REQUIREMENTS

Trước khi chạy, PHẢI có:

```
REQUIRED:
  → docs/specs/<feature>.md (output Gate 1) HOẶC thiết kế DB đã chốt tại Gate 2

OPTIONAL BUT HIGHLY RECOMMENDED:
  → docs/design/ hoặc docs/screenshot/ chứa ảnh tham khảo đã có.
```

---

## 🔄 PROCESS

### Phase 1: Context Gathering (Silent)

```
1. Đọc spec document của feature để xác định các elements UI cần thiết
   (Danh sách nút, forms, data grids, navigations).
2. Quyét thư mục `docs/design/` và `docs/screenshot/` xem đã có ảnh tham khảo chưa.
3. Nếu CÓ ẢNH: Đọc và report phân tích UI của ảnh, và chuyển luôn sang Phase 3 (Approval).
4. Nếu KHÔNG CÓ ẢNH: Chuyển sang Phase 2 (Pencil Draft).
```

### Phase 2: Pencil Blueprint Drafting

```
Khi dự án được chốt là CHƯA có giao diện mẫu, AI phải:
1. Thông báo cho User: "Để chúng ta hiểu đúng ý nhau về giao diện, tôi sẽ phác thảo một bản vẽ UI bằng công cụ Pencil. Quá trình này sẽ mất một chút thời gian xử lý."
2. Chạy tool `open_document` để tạo file `docs/design/<feature>.pen` (nếu chưa có).
3. Sử dụng tool `batch_design`:
   - Dựng Layout theo chuẩn component (Container, Navbar, Sidebar, Content).
   - Thêm Text, Buttons, Forms theo dữ liệu đã chốt từ spec-gate (ví dụ: spec ghi có login form email/pass, thì màn hình phải có 2 input + submit button).
   - Áp color/theme phù hợp với identity của project.
4. Render screenshot của Pencil (sử dụng `get_screenshot` node id của screen).
```

### Phase 3: Present & Approval

```
Present cho user với format sau:

───────────────────────────────────
🎨 UI/UX DESIGN PREVIEW: <Feature Name>
───────────────────────────────────

## Design Source
[Trạng thái: Đã đọc từ ảnh `docs/design/mockup.png` HOẶC Bản nháp Pencil `docs/design/<feature>.pen`]

## Core UI Components
- [Component 1]: [Mô tả vai trò, ví dụ: Authentication Form chứa inputs login]
- [Component 2]: [Mô tả trạng thái state...]
- [Component 3]: ...

## Hình ảnh Preview
[Đính kèm Screenshot preview nếu dùng Pencil]

───────────────────────────────────
⏳ Anh xem giao diện tổ chức thế này đã đúng ý đồ anh muốn chưa?
   - Nếu cần tôi tinh chỉnh bố cục, màu sắc bằng Pencil thì anh cứ báo.
   - Nếu anh đã chốt, phản hồi "OK" để tôi chia task code nhé!
───────────────────────────────────
```

### Phase 4: Write UI Decision Doc

Sau khi user approve:

```
1. (Nếu xài thư mục chung) Ghi vào file README của thư mục `docs/design/` các quyết định chính về giao diện.
2. Lưu vào NeuralMemory:
   nmem_remember(
     content="Visual Design for <feature> approved. Focus points: <summary_ui_points>",
     type="decision",
     tags=["ui", "design", "<projectId>", "<feature>"]
   )
3. Proceed → Orchestrator re-checks Gate 2.5 → PASS → Gate 3 (Symphony tasks).
```

---

## 🔙 DESIGN REVISION PROTOCOL

Khi User yêu cầu sửa bản Pencil phác thảo:

```
1. Xác định chính xác node cần sửa.
2. Dùng batch_get từ Pencil MCP để lấy IDs các khung components liên quan.
3. Chạy Update (U) hoặc Replace (R) logic trên Pencil batch_design tool.
4. Cập nhật screenshot UI mới gửi lại User.
5. Tiếp tục vòng lặp cho đến khi "Approved".
```

---

## 🗣️ Communication Style

```
❌ "Please provide design mockups or approve the design generation process."
✅ "Để mình đồng điệu cách triển khai, tôi nghĩ nên phác thảo qua cái giao diện một chút. 
    Anh có ảnh màn hình / mockup (Figma/PNG) sẵn trong thư mục nào không, hay để tôi dùng công cụ Pencil vẽ nhanh 1 bản phác thảo anh xem qua?"
```

---

## 🚫 Anti-Patterns

```yaml
never_do:
  - Ép user xài Pencil nếu user đã copy đầy đủ file design (ảnh, video) vào /docs/.
  - Code Front-end UI (HTML/CSS/Swift) khi người dùng chưa đồng ý phương án bố cục.
  - Vẽ chi tiết quá mất thời gian cho những task internal/CLI thuần túy (Orchestrator phải skip Gate này cho Backend).
  
always_do:
  - Báo hiệu quá trình thao tác với Pencil vì nó sẽ mất thời gian load server, render node, chụp screenshot.
  - Tái sử dụng các rules về spacing/màu sắc nếu trong file .pen đã có sẵn Design System Variables.
```

---

*visual-design-gate v1.0 — Visual Design & UI Sync Gate for AWKit*
