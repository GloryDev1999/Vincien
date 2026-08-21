---
name: smart-token-caching
description: 'Kỹ thuật tối ưu hóa KV-Cache và cắt giảm token thông minh trong Agent loop, Prompting, File editing, và Context management.'
---

# Smart Token Caching & Optimization

Kỹ năng và hướng dẫn toàn diện nhằm tối ưu hóa việc sử dụng Token, tận dụng tối đa Prefix Caching / KV-Cache của các mô hình ngôn ngữ lớn (DeepSeek, Claude, GPT), và giữ cho ngữ cảnh phiên làm việc luôn tinh gọn, hiệu năng cao.

---

## 1. Cơ chế KV Cache & Prefix Stability

Các LLM hiện đại (DeepSeek V3/R1, Claude 3.5/3.7, GPT-4o) hỗ trợ **Prompt Caching / KV Cache Reuse**. Khi phần đầu của ngữ cảnh (prefix) không thay đổi giữa các lượt gọi:
* **Tốc độ sinh phản hồi (TTFT)** tăng từ 2x - 5x.
* **Chi phí token đầu vào (Input Tokens)** giảm 50% - 90% (ví dụ: DeepSeek Cache Hit chỉ tính ~10% giá token thông thường).

### Nguyên tắc giữ ổn định Prefix:
1. **Neo phần tĩnh ở đầu (Static Anchor)**: System Prompt, Persona, danh sách công cụ cố định phải luôn đặt ở đầu và không thay đổi động theo từng turn.
2. **Tránh chèn timestamp động vào System Prompt**: Timestamp nên đặt ở phần thông tin ngữ cảnh hoặc metadata sự kiện thay vì chèn vào đầu prompt cố định làm đứt gãy cache.
3. **Cấu trúc nối đuôi (Append-only History)**: Lịch sử hội thoại nối đuôi giúp duy trì cache hit cho toàn bộ các turn trước đó.

---

## 2. Tối ưu Thao tác Đọc/Ghi File & Code Editing

### Tránh Đọc Toàn Bộ File Quá Lớn
* Sử dụng cơ chế phân trang `offset` và `limit` (cửa sổ đọc tối ưu: 50 - 200 dòng quanh vùng cần xử lý) thay vì đọc toàn bộ file hàng nghìn dòng.
* Dùng ripgrep (`grep_search`) để định vị chính xác vị trí cần chỉnh sửa trước khi đọc.

### Ưu tiên Targeted Edits (Thay thế cục bộ) thay vì Rewrite Toàn Bộ File
* **Không dùng lệnh ghi đè toàn bộ file (full file overwrite)** cho các thay đổi nhỏ vài dòng. Ghi đè 1000 dòng chỉ để đổi 2 dòng làm tiêu tốn 1000 input tokens + 1000 output tokens.
* **Sử dụng `replace_file_content`** với khối `TargetContent` và `ReplacementContent` chính xác, tiết kiệm 95% token so với viết lại file.

---

## 3. Cắt tỉa Ngữ cảnh Động (Dynamic Context Pruning & Compaction)

1. **Rút gọn Tool Results**:
   * Khi công cụ trả về kết quả lớn (ví dụ: log build dài, danh sách file đồ sộ), chỉ giữ lại các dòng tóm tắt quan trọng và lỗi cốt lõi.
   * Cắt bỏ chuỗi ANSI escape codes, progress bar thừa trong terminal output.
2. **Tự động Compaction khi đạt ngưỡng**:
   * Khi ngữ cảnh đạt trên 60% context window, kích hoạt tóm tắt các turn cũ để giải phóng token cho các turn xử lý chuyên sâu tiếp theo.

---

## 4. Ngăn ngừa Rò rỉ Suy luận (CoT Token Leakage)

* Tránh lặp lại quá trình reasoning dài dòng trong câu trả lời cuối cùng cho user.
* Trình bày trực diện câu trả lời logic, sử dụng **Bảng biểu (Markdown Tables)** và **Gạch đầu dòng (Bullet points)** giúp truyền tải lượng thông tin tối đa với số lượng token tối thiểu.

---

## 5. Phân tách Context qua Subagent Delegation

* Với các tác vụ nghiên cứu rộng (khảo sát 50+ files, web search nhiều trang), ủy thác cho **Subagent** chuyên trách.
* Subagent hoàn thành công việc trong context riêng biệt và chỉ trả về bản tóm tắt tinh gọn cho Main Agent, ngăn ngừa việc phình to context của session chính.
