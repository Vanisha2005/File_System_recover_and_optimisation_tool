# File_System_recover_and_optimisation_tool
A smart File System Recovery &amp; Optimization Tool that simulates real-time disk behavior, detects fragmentation, restores lost data, and boosts performance. Designed with an interactive UI and intelligent logic to visualize how modern operating systems manage storage efficiently.
# DiskOS v2 — File System Recovery & Optimization Tool

**Author:** Vanisha  
**Stack:** Python · Flask · Vanilla JS · IBM Plex Mono · Bebas Neue

---

## Quick Start

```bash
pip install flask
python app.py
# → http://127.0.0.1:5000
```

---

## Project Structure

```
diskos-v2/
├── app.py                    ← Flask backend + all filesystem logic
├── requirements.txt
├── templates/
│   └── index.html            ← Main HTML (3-column layout)
└── static/
    ├── css/style.css         ← Full dark industrial UI
    └── js/app.js             ← Frontend logic, state, API calls
```

---

## All 11 API Endpoints

| Method   | Endpoint              | Description                              |
|----------|-----------------------|------------------------------------------|
| GET      | `/api/state`          | Full filesystem snapshot                 |
| POST     | `/api/write`          | Create file `{name, content}`            |
| GET      | `/api/read/<id>`      | Read file content by inode id            |
| PUT      | `/api/update/<id>`    | Overwrite file, reallocate blocks        |
| DELETE   | `/api/delete/<id>`    | Soft-delete (marks blocks reclaimable)   |
| POST     | `/api/recover`        | Selective `{inode_id}` or bulk `{}`      |
| POST     | `/api/defrag`         | Pack active files into contiguous blocks |
| POST     | `/api/format`         | Wipe entire filesystem                   |

---

## Feature Checklist

### Core File System
- [x] Bitmap allocation (128 blocks × 64 B)
- [x] Inode structure: id, name, ext, blocks, size, created, modified, status
- [x] Write, Read, Delete, **Update** (CRUD)
- [x] Fragmentation calculation
- [x] Disk stats: capacity %, used, free, reclaimable, files, deleted

### UI
- [x] Live bitmap disk map (16×8 grid)
- [x] Color-coded blocks: free / used / deleted (flickering)
- [x] Capacity bar + fragmentation bar with level labels
- [x] Inode table with filter tabs (All / Active / Deleted)
- [x] File viewer with metadata strip
- [x] System log with color-coded levels
- [x] Toast notifications
- [x] Block inspector on hover (shows owner, byte range, state)
- [x] Amber highlight for selected file's blocks on disk map

### Selection System
- [x] Radio-select in inode table
- [x] Action bar: READ · EDIT · DELETE · RECOVER (per selection)
- [x] Context-aware button enable/disable (active vs deleted)

### Edit Mode
- [x] Load file into editor with "EDIT MODE" badge
- [x] Block reallocation delta preview (±N blocks)
- [x] Cancel edit without saving
- [x] PUT /api/update reallocates blocks intelligently

### Selective Recovery
- [x] POST /api/recover with `{inode_id}` = single file
- [x] POST /api/recover with `{}` = bulk recovery
- [x] Conflict detection: blocks overwritten → skip + warn
- [x] Returns `{recovered: [...], skipped: [...]}`

### Data Integrity
- [x] Duplicate filename prevention
- [x] Write debounce (no race conditions)
- [x] Input validation with error toast
- [x] Viewer resets on delete / format
- [x] UI fully synced with backend state

---

## How Core Concepts Work

### Bitmap Allocation
```
bitmap[i] = 0  →  FREE
bitmap[i] = 1  →  USED
bitmap[i] = 2  →  DELETED (reclaimable)
```
`blocks_needed(content) = ceil(len(content) / 64)`  
Allocator scans bitmap left-to-right for the first N free blocks.

### Inode Structure
```python
{
  "id":       int,          # unique inode number
  "name":     str,          # filename
  "ext":      str,          # extension for color-coding
  "content":  str,          # raw file data
  "blocks":   [int],        # allocated block indices
  "size":     int,          # bytes
  "created":  "HH:MM:SS",
  "modified": "HH:MM:SS",
  "status":   "active" | "deleted"
}
```

### File Update (Block Reallocation)
1. Free old blocks → bitmap[b] = 0
2. Calculate new block count
3. Allocate new blocks (may be different indices)
4. Update inode in place

### Recovery Algorithm
```
for each deleted inode:
    if none of its blocks have been reallocated (bitmap[b] != 1):
        restore blocks → bitmap[b] = 1
        set status = "active"
    else:
        skip (data overwritten)
```

### Defragmentation
1. Collect all active inodes
2. Reset entire bitmap to 0
3. Reassign blocks sequentially from block 0
4. Update each inode's block list

---

## Interview Talking Points

- **O(n) block scan** — allocator is linear in total blocks (good for interview discussion of B-tree / free-list optimizations)
- **Soft delete** — blocks marked `2` not `0`, enabling recovery without journaling
- **Reallocation on update** — simulates how real FS handles file growth (extent-based vs block-map)
- **Fragmentation metric** — counts gaps between sorted active blocks; 0% = fully contiguous
