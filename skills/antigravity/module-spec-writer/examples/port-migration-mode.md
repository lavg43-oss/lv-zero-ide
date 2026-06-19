# Port/Migration Mode

Khi project là port/migration (iOS→Android, Android→iOS):

## Special Behavior

### Kiro-First Check (luôn chạy trước)
0. Scan `.kiro/specs/` → nếu có module folders với `requirements.md`:
   - Dùng Kiro specs làm source of truth
   - SKIP source code scanning (Kiro đã tổng hợp)
   - Cross-reference với source code CHỈ để verify completeness

### Fallback (khi không có .kiro/specs)
1. Scan source codebase TRƯỚC → auto-detect modules
2. Đọc existing KnowledgeItems cho source project
3. Cross-reference với BRIEF.md để catch missing modules
4. Generate specs từ source code structure + knowledge

## Auto-Detection Sources

### iOS
- Xcode project navigator groups
- `Features/` or `Presentation/Views/` folders
- NavigationStack/TabView structure
- Existing CODEBASE.md

### Android
- `feature/` packages
- Navigation graph (`nav_graph.xml`)
- Activity/Fragment inventory
- Existing CODEBASE.md

### Kiro
- `.kiro/specs/<module>/requirements.md` (pre-generated)
- `.kiro/specs/<module>/design.md` (pre-generated)
- `.kiro/specs/<module>/tasks.md` (pre-generated)

## Output
Pre-filled module specs with data from source code OR Kiro specs.
User chỉ cần review + approve, không cần viết từ đầu.
