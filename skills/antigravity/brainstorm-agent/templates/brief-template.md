# BRIEF.md Template & Brainstorm Output

```markdown
# 💡 BRIEF: [Tên dự án/tính năng]

**Ngày tạo:** [Date]
**Brainstorm mode:** [Quick/Full/Feature]

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT
[Mô tả vấn đề]

## 2. GIẢI PHÁP ĐỀ XUẤT
[Hướng đi được chọn + lý do]

## 3. ĐỐI TƯỢNG SỬ DỤNG
- **Primary:** [...]
- **Secondary:** [...]

## 4. TÍNH NĂNG

### 🚀 MVP:
- [ ] [Feature 1]
- [ ] [Feature 2]

### 🎁 Phase 2:
- [ ] [Feature 3]

### 💭 Backlog:
- [ ] [Feature 4]

## 5. MODULE BREAKDOWN

### Module: [Module Name 1]
- **Mục đích:** [1 dòng]
- **Screens chính:** [list screens]
- **Core flows:** [list main user journeys]

### Module: [Module Name 2]
- **Mục đích:** [1 dòng]
- **Screens chính:** [list screens]
- **Core flows:** [list main user journeys]

## 6. ƯỚC TÍNH
- **Độ phức tạp:** [Đơn giản / Trung bình / Phức tạp]
- **Hướng tiếp cận:** [Approach được chọn]
- **Số modules:** [N]

## 7. BƯỚC TIẾP THEO
→ Module spec chi tiết (Gate 1.5) → Thiết kế kỹ thuật (Gate 2)
```

---

# Symphony Notes Auto-Save

Sau khi tạo BẤT KỲ brainstorm artifact nào → POST metadata vào Symphony Notes API:

```bash
curl -X POST http://localhost:3100/api/notes -H 'Content-Type: application/json' -d '{
  "projectId": "<current-project-id>",
  "type": "brainstorm",
  "title": "<artifact-title>",
  "content": "<summary-2-3-lines-ONLY>",
  "filePath": "<absolute-path-to-artifact-file>",
  "conversationId": "<current-conversation-id>",
  "metadata": {
    "mode": "quick|full|feature",
    "tags": ["pricing", "features", "architecture"],
    "created_by": "brainstorm-agent"
  }
}'
```

**Rules:** content CHỈ 2-3 dòng summary. Nếu Symphony offline → skip silently.
