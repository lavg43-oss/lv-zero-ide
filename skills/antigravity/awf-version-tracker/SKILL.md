---
name: awf-version-tracker
description: Auto-snapshot skills and workflows to ensure rollback capabilities and tracking version drift
trigger: session_start
priority: 3
---

# AWF Version Tracker (Skill Evolver Integration)

> **Purpose:** Tự động tạo snapshot các file kỹ năng (Skills) và quy trình (Workflows) mỗi khi session mới bắt đầu.
> **Philosophy:** Regression-Averse. Giữ lại một bộ lùi version tự động để an toàn sau những lần `/customize`.

---

## Trigger conditions
- **Mỗi khi User bắt đầu thao tác ở 1 session mới**
- Chạy tự động, ngay sau bộ `orchestrator` và `awf-session-restore`.

## Hành động (Execution)

1. **Log thông báo**: "📸 Saving system snapshot..."
2. **Chạy script `snapshot.sh`**:
   - `sh ~/.gemini/antigravity/skills/awf-version-tracker/scripts/snapshot.sh`
   - Kịch bản sẽ sao chép `global_workflows` và `skills` và nén vào thư mục `~/.gemini/antigravity/brain/versions/` với tên file gắn Timestamp.
   - Kịch bản chỉ giữ lại tối đa 10 snapshots gần nhất.
3. **Tiếp nối quy trình**: Không chặn hay hỏi thêm người dùng trừ khi có lỗi permission xảy ra.

## Phục hồi (Rollback)

Nếu User yêu cầu lùi phiên bản `/skill-rollback`:
- Nhắc User xem danh sách snapshot ở `~/.gemini/antigravity/brain/versions/`
- Command để giải nén lại snapshot: `unzip -o snapshot_name.zip -d /`
