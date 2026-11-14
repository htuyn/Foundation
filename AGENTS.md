# AGENTS.md — FOUNDATION PROJECT

# 1. QUY TẮC LÀM VIỆC

## Vai trò và ngôn ngữ

- Hành xử như một kỹ sư phần mềm cấp cao.
- Luôn giao tiếp với người dùng bằng tiếng Việt. Chỉ nội dung mã nguồn giữ nguyên ngôn ngữ lập trình tương ứng.

## Phạm vi và an toàn

- Chỉ chỉnh sửa chính xác những dòng cần thiết để đáp ứng yêu cầu. Không chạm, định dạng lại hoặc dọn dẹp mã không liên quan.
- Trước khi sửa, xem xét tác động phụ và bảo đảm thay đổi không làm hỏng logic, import, giao diện hoặc phần khác của ứng dụng.
- Không tự suy đoán hay bịa biến, hàm, import hoặc ngữ cảnh còn thiếu. Nếu không đủ thông tin để sửa an toàn, dừng lại và hỏi người dùng hoặc yêu cầu tệp liên quan.
- Giữ nguyên phong cách mã, quy ước đặt tên và kiến trúc hiện có. Không thêm thư viện hoặc viết lại cách triển khai nếu người dùng không yêu cầu.

## Chất lượng mã

- Không dùng placeholder như `// ... existing code ...` hoặc `/* rest of the function */`.
- Khi cung cấp mã, phải ghi rõ tên tệp và đưa ra phần mã chính xác, đầy đủ để áp dụng mà không làm mất logic hiện có.
- Kiểm tra dấu ngoặc, thụt lề và cú pháp trước khi hoàn tất.

## Quy trình và phản hồi

- Xác định vấn đề và đúng vị trí cần sửa trước khi thay đổi.
- Giải thích ngắn gọn, mang tính kỹ thuật bằng tiếng Việt.
- Chỉ thực hiện trong phạm vi người dùng yêu cầu; không tự ý mở rộng công việc.

# 2. MEMORY BANK

- Trước khi xử lý yêu cầu dự án, đọc các tài liệu trong `.memory-bank/` để nắm ngữ cảnh; nếu chưa có, quét cấu trúc và cấu hình dự án rồi tạo đủ sáu tài liệu theo hướng dẫn trong Memory Bank.
- Sau feature, sửa lỗi hoặc thay đổi kiến trúc, cập nhật ngay các tài liệu Memory Bank tương ứng, đặc biệt `activeContext.md` và `progress.md`.
- Giữ tài liệu bám sát trạng thái thực tế; phân biệt rõ tính năng đã triển khai, giới hạn và công việc chưa hoàn thành.
- Không ghi mật khẩu, token, connection string hoặc thông tin xác thực vào Memory Bank.

# 3. KIẾN TRÚC VÀ CÔNG NGHỆ DỰ ÁN

Phải kiểm tra source code thực tế trước khi kết luận về kiến trúc.

Các công nghệ chính đã được sử dụng trong Foundation:

- Frontend: React, TypeScript, Vite.
- Backend: Python, FastAPI.
- Database: PostgreSQL trên Neon.
- ORM: SQLAlchemy.
- Migration: Alembic.
- Frontend deployment: Vercel.
- Backend deployment: Render.

## Nguyên tắc phân chia trách nhiệm

### Frontend

- Chịu trách nhiệm giao diện và trải nghiệm người dùng.
- Gọi API Backend để đọc và ghi dữ liệu.
- Không kết nối trực tiếp PostgreSQL Production.
- Không chứa thông tin đăng nhập database.
- Không thay thế logic nghiệp vụ quan trọng của Backend.

### Backend

- Chịu trách nhiệm xử lý nghiệp vụ.
- Kiểm tra dữ liệu đầu vào và quyền truy cập.
- Tương tác PostgreSQL thông qua SQLAlchemy hoặc cơ chế hiện có.
- Xử lý lỗi, transaction và tính toàn vẹn dữ liệu.
- Không tự ý thay đổi schema ngoài quy trình migration.

### Database

- Là nguồn dữ liệu chính thức của hệ thống.
- Phải bảo đảm tính toàn vẹn và nhất quán.
- Thay đổi cấu trúc phải được quản lý bằng Alembic.
- Không tùy tiện chỉnh sửa Production để bỏ qua lịch sử migration.

# 4. QUY TẮC NEON POSTGRESQL MCP

## 4.1. Nguyên tắc chung

- Neon MCP là công cụ hỗ trợ AI truy cập database, không phải thành phần bắt buộc để ứng dụng hoạt động.
- Chỉ sử dụng Neon MCP khi công cụ AI hiện tại đã được cấu hình và xác thực thành công.
- Không giả định mọi AI hoặc thành viên trong nhóm đều có Neon MCP.
- Không mặc định MCP đang kết nối đúng Project, branch hoặc database.
- Trước khi thao tác, xác định môi trường Development hay Production.
- Không giả vờ đã truy cập database khi MCP chưa kết nối.

## 4.2. Khả năng sử dụng Neon MCP

Khi có MCP và quyền phù hợp, AI có thể:

- Kiểm tra schema và danh sách bảng.
- Đọc cấu trúc cột và kiểu dữ liệu.
- Kiểm tra Primary Key, Foreign Key, Index và Constraint.
- Đọc dữ liệu phục vụ phân tích.
- Kiểm tra quan hệ giữa các bảng.
- Phân tích dữ liệu bất thường.
- Đối chiếu database với SQLAlchemy models.
- Kiểm tra lịch sử migration.
- Thực hiện thay đổi dữ liệu theo quyền được cấp.

## 4.3. Quy tắc bảo mật

- Chỉ sử dụng quyền truy cập cần thiết.
- Không yêu cầu hoặc sử dụng Neon Owner nếu không thực sự cần thiết.
- Không tiết lộ mật khẩu, connection string, API key hoặc OAuth token.
- Không đưa thông tin xác thực vào source code, `AGENTS.md`, Memory Bank hoặc GitHub.
- Không commit file `.env` hoặc file chứa thông tin bí mật.
- Kiểm tra `.gitignore` để bảo đảm file môi trường được loại trừ.
- Không in toàn bộ thông tin kết nối database vào terminal hoặc log.
- Không chia sẻ tài khoản database cá nhân giữa các thành viên.

## 4.4. Khi đọc Database

Trước khi truy vấn:

1. Xác định đúng Neon Project.
2. Xác định đúng branch.
3. Xác định đúng database.
4. Kiểm tra schema thực tế.
5. Chỉ truy vấn dữ liệu cần thiết.

Không được:

- Tự đoán tên bảng hoặc tên cột.
- Tự giả định quan hệ giữa các bảng.
- Giả định database giống hoàn toàn với SQLAlchemy models.
- Truy vấn hoặc xuất dữ liệu nhạy cảm không liên quan đến nhiệm vụ.
- Truy vấn hàng loạt khi không cần thiết.

## 4.5. Khi thêm, sửa hoặc xóa dữ liệu

Trước khi thực hiện:

1. Xác định chính xác bảng và bản ghi.
2. Kiểm tra điều kiện truy vấn.
3. Kiểm tra khóa ngoại và quan hệ phụ thuộc.
4. Đánh giá ảnh hưởng nghiệp vụ.
5. Xác định khả năng rollback.
6. Yêu cầu xác nhận nếu thao tác có rủi ro đáng kể.

Sau khi thực hiện:

- Kiểm tra lại dữ liệu.
- Xác nhận số lượng bản ghi bị ảnh hưởng.
- Kiểm tra tính toàn vẹn dữ liệu.
- Báo cáo kết quả thực tế.

Không tự ý:

- DROP DATABASE.
- DROP TABLE.
- TRUNCATE TABLE.
- DELETE hàng loạt.
- UPDATE hàng loạt.
- Xóa dữ liệu người dùng.
- Thay đổi quyền truy cập.
- Thực hiện thao tác có nguy cơ mất dữ liệu trên Production.

Các thao tác nguy hiểm phải được người dùng xác nhận rõ ràng trước khi thực hiện.

# 5. QUY TẮC TƯƠNG THÍCH VỚI AI KHÔNG CÀI MCP

## 5.1. Nguyên tắc bắt buộc

- Dự án phải hoạt động độc lập với công cụ AI đang sử dụng.
- Không yêu cầu mọi AI phải cài Neon MCP.
- Không để thiếu MCP làm gián đoạn các công việc không liên quan đến database.
- Không phụ thuộc vào OpenCode, Claude Code, Cursor, Antigravity hoặc một công cụ AI cụ thể.
- MCP chỉ là công cụ hỗ trợ AI, không phải dependency của ứng dụng.

## 5.2. Khi AI không có Neon MCP

AI vẫn phải có khả năng:

- Đọc và phân tích source code.
- Đọc SQLAlchemy models.
- Đọc Alembic migrations.
- Phát triển và sửa lỗi Frontend.
- Phát triển và sửa lỗi Backend.
- Phân tích API và luồng nghiệp vụ.
- Viết và kiểm tra migration.
- Kiểm tra cấu hình dự án.
- Chạy các kiểm tra phù hợp với môi trường hiện tại.

Khi cần thông tin database:

- Ưu tiên kiểm tra models, migrations và tài liệu có sẵn.
- Nếu cần schema thực tế, yêu cầu người dùng cung cấp thông tin cần thiết.
- Không giả định schema thực tế chỉ dựa vào source code.
- Không tuyên bố đã kiểm tra database khi chưa có quyền truy cập.

## 5.3. Những việc không được phụ thuộc MCP

- Không import thư viện MCP vào Frontend hoặc Backend chỉ để phục vụ AI.
- Không yêu cầu MCP để khởi động ứng dụng.
- Không yêu cầu MCP để build Frontend.
- Không yêu cầu MCP để chạy Backend.
- Không yêu cầu MCP để chạy test.
- Không đưa URL MCP vào logic nghiệp vụ.
- Không sử dụng MCP thay thế SQLAlchemy.
- Không làm thay đổi ứng dụng chỉ vì AI không hỗ trợ MCP.

## 5.4. Phân biệt quyền của AI

- AI có MCP: sử dụng MCP theo quyền được cấp.
- AI không có MCP: làm việc dựa trên source code, tài liệu và thông tin được cung cấp.
- AI chỉ có quyền đọc: không được tìm cách ghi database.
- AI có quyền ghi: chỉ thực hiện các thao tác được cho phép.
- Không mặc định AI có quyền truy cập Production.
- Không tìm cách vượt qua giới hạn quyền truy cập.

## 5.5. Khi thiếu công cụ hoặc thông tin

- Không dừng toàn bộ nhiệm vụ chỉ vì thiếu MCP.
- Chỉ dừng phần công việc thực sự cần quyền truy cập còn thiếu.
- Tiếp tục những phần độc lập có thể thực hiện an toàn.
- Phân biệt rõ nội dung đã xác minh và chưa xác minh.
- Hỏi người dùng nếu thiếu thông tin quan trọng.
- Không tự suy đoán để thay thế dữ liệu thực tế.

# 6. QUY TRÌNH THAY ĐỔI CẤU TRÚC DATABASE

Mọi thay đổi schema phải tuân theo quy trình:

**SQLAlchemy Model → Alembic Migration → Kiểm tra → Áp dụng Database**

## 6.1. Khi thêm bảng hoặc cột

1. Kiểm tra schema thực tế nếu có quyền truy cập.
2. Đọc SQLAlchemy models.
3. Kiểm tra migration hiện có.
4. Xác định cấu trúc cần thay đổi.
5. Cập nhật SQLAlchemy models.
6. Tạo Alembic migration mới.
7. Kiểm tra nội dung migration.
8. Đánh giá ảnh hưởng đến dữ liệu cũ.
9. Kiểm tra trên Development.
10. Chỉ áp dụng Production sau khi được phê duyệt.
11. Kiểm tra kết quả sau migration.

## 6.2. Khi sửa hoặc xóa cột

Phải kiểm tra:

- Dữ liệu hiện có.
- Backend đang sử dụng cột.
- API request và response.
- Frontend đang đọc trường dữ liệu.
- Khóa ngoại và constraint.
- Index.
- Các truy vấn liên quan.
- Khả năng tương thích ngược.

Ưu tiên migration nhiều giai đoạn khi thay đổi có nguy cơ làm gián đoạn hệ thống.

## 6.3. Quy tắc Alembic

- Không chỉnh sửa migration cũ đã triển khai trên môi trường dùng chung.
- Tạo migration mới để sửa đổi schema.
- Không tự ý xóa lịch sử migration.
- Không tự ý sửa bảng `alembic_version`.
- Không tự chạy `alembic upgrade head` trên Production khi chưa được phê duyệt.
- Không tự chạy `alembic downgrade` trên Production.
- Không tạo migration chỉ để che giấu lỗi schema drift.
- Phải kiểm tra nội dung migration trước khi áp dụng.
- Nếu migration có nguy cơ mất dữ liệu, phải cảnh báo và yêu cầu xác nhận.

# 7. ĐỒNG BỘ FRONTEND – BACKEND – DATABASE

Khi thay đổi trường dữ liệu hoặc chức năng, phải kiểm tra toàn bộ luồng:

**Frontend → API → Backend → ORM → PostgreSQL**

Và chiều trả dữ liệu:

**PostgreSQL → ORM → Backend Response → API → Frontend**

## Backend

Kiểm tra các thành phần liên quan:

- SQLAlchemy models.
- Pydantic schemas.
- API endpoints.
- CRUD operations.
- Services.
- Repository nếu có.
- Validation.
- Transaction.
- Các truy vấn SQL.

## Frontend

Kiểm tra:

- TypeScript interfaces và types.
- API services.
- Form nhập liệu.
- Component hiển thị dữ liệu.
- Bảng dữ liệu và bộ lọc.
- Chức năng thêm, sửa, xóa.
- Loading và error states.

## Nguyên tắc

- Database, Backend và Frontend phải thống nhất về cấu trúc và ý nghĩa dữ liệu.
- Không chỉ sửa database mà bỏ qua Backend.
- Không chỉ sửa Backend mà bỏ qua Frontend nếu API contract thay đổi.
- Không tự ý đổi tên API hoặc trường dữ liệu đang được sử dụng.
- Kiểm tra tương thích ngược khi thay đổi API hoặc schema.

# 8. QUY TẮC LÀM VIỆC VỚI MÔI TRƯỜNG

Phải phân biệt rõ ba môi trường:

## Local

- PostgreSQL chạy trên máy hoặc Docker của nhà phát triển.
- Chỉ ảnh hưởng dữ liệu local.
- Không mặc định đồng bộ với Neon.

## Neon Development

- Dùng để phát triển và thử nghiệm.
- Ưu tiên kiểm tra migration và thay đổi dữ liệu tại đây trước Production.

## Neon Production

- Database thực tế của ứng dụng.
- Mọi thay đổi phải được kiểm soát.
- Không tự ý thử nghiệm, xóa dữ liệu hoặc chạy migration nguy hiểm.
- Cần xác nhận trước các thay đổi có rủi ro.

Không được tuyên bố dữ liệu Local đã cập nhật lên Neon nếu chưa thực sự đồng bộ.

# 9. BACKUP VÀ PHỤC HỒI

Trước thay đổi Production có nguy cơ mất dữ liệu:

- Kiểm tra trạng thái backup gần nhất.
- Xác định khả năng phục hồi.
- Xem xét Neon branching hoặc quy trình backup hiện có.
- Không mặc định có backup đồng nghĩa với phục hồi chắc chắn thành công.
- Không tự ý restore lên Production.
- Sau phục hồi, kiểm tra tính toàn vẹn và khả năng hoạt động của ứng dụng.

# 10. QUY TẮC API VÀ NGHIỆP VỤ

- Kiểm tra API hiện có trước khi tạo API mới.
- Giữ nguyên quy ước URL, HTTP method và response format của dự án.
- Kiểm tra validation dữ liệu đầu vào.
- Xử lý đúng HTTP status code.
- Không để lộ stack trace hoặc thông tin nhạy cảm cho người dùng.
- Kiểm tra quyền truy cập và xác thực.
- Không bỏ qua logic nghiệp vụ hiện có.
- Không tạo API trùng chức năng khi chưa kiểm tra.

# 11. QUY TẮC KIỂM TRA VÀ CHẤT LƯỢNG

Sau khi chỉnh sửa:

- Kiểm tra cú pháp và import.
- Kiểm tra lỗi TypeScript/Python phù hợp với phạm vi.
- Chạy test liên quan nếu có.
- Kiểm tra build nếu có thay đổi Frontend.
- Kiểm tra API nếu có thay đổi Backend.
- Kiểm tra migration nếu có thay đổi database.
- Kiểm tra các luồng nghiệp vụ liên quan.
- Không bỏ qua lỗi mới phát sinh từ thay đổi.
- Không tuyên bố thành công khi chưa thực sự kiểm tra.

Nếu môi trường không cho phép chạy kiểm tra, phải báo rõ lý do.

# 12. QUY TẮC TRIỂN KHAI

## Frontend

- Kiểm tra build trước khi triển khai.
- Không đưa secret vào biến môi trường public.
- Không tự ý thay đổi cấu hình Vercel ngoài phạm vi yêu cầu.

## Backend

- Kiểm tra API và cấu hình môi trường.
- Không đưa secret vào source code.
- Kiểm tra kết nối Neon và cấu hình CORS.
- Không tự ý thay đổi cấu hình Render Production.

## Database

- Không mặc định Git push sẽ cập nhật schema Neon.
- Không mặc định Vercel hoặc Render tự chạy migration.
- Migration phải được thực hiện theo quy trình riêng.
- Phải xác minh kết quả sau triển khai.

# 13. CẬP NHẬT TÀI LIỆU DỰ ÁN

Sau khi hoàn thành feature, sửa lỗi hoặc thay đổi kiến trúc:

- Cập nhật `activeContext.md`.
- Cập nhật `progress.md`.
- Cập nhật tài liệu kiến trúc hoặc database nếu liên quan.
- Ghi lại migration mới và mục đích.
- Ghi rõ trạng thái đã triển khai hay chưa.
- Ghi rõ môi trường đã được cập nhật.
- Không ghi thông tin xác thực vào tài liệu.

Tài liệu phải phản ánh đúng trạng thái thực tế của dự án.

# 14. QUY TRÌNH LÀM VIỆC CHUẨN

Mỗi yêu cầu dự án thực hiện theo các giai đoạn:

## Giai đoạn 1: Khảo sát

- Đọc AGENTS.md.
- Đọc Memory Bank.
- Kiểm tra cấu trúc source code.
- Đọc các file liên quan.
- Kiểm tra công cụ cần thiết có sẵn hay không.

## Giai đoạn 2: Phân tích

- Xác định vấn đề.
- Xác định nguyên nhân.
- Xác định vị trí cần sửa.
- Đánh giá ảnh hưởng.
- Kiểm tra các thành phần phụ thuộc.

## Giai đoạn 3: Lập kế hoạch

- Đưa ra phương án.
- Liệt kê file dự kiến chỉnh sửa.
- Xác định có cần thay đổi database hay không.
- Xác định có cần migration hay không.
- Xác định rủi ro và phương án kiểm tra.

## Giai đoạn 4: Thực hiện

- Chỉ chỉnh sửa phần cần thiết.
- Giữ nguyên kiến trúc hiện có.
- Không mở rộng phạm vi.
- Tuân thủ quyền truy cập.
- Không tự ý thay đổi Production.

## Giai đoạn 5: Kiểm tra

- Kiểm tra cú pháp.
- Kiểm tra logic.
- Kiểm tra Backend và Frontend liên quan.
- Kiểm tra database nếu có quyền truy cập.
- Kiểm tra các chức năng bị ảnh hưởng.

## Giai đoạn 6: Báo cáo

Báo cáo bằng tiếng Việt:

- Vấn đề ban đầu.
- Nguyên nhân.
- Các file đã thay đổi.
- Các bảng hoặc cột bị ảnh hưởng.
- Migration đã tạo hay chưa.
- Migration đã chạy ở môi trường nào.
- Các kiểm tra đã thực hiện.
- Kết quả thực tế.
- Những phần chưa hoàn thành hoặc còn hạn chế.

# 15. NGUYÊN TẮC ƯU TIÊN CAO NHẤT

Khi có xung đột giữa tốc độ và tính an toàn, ưu tiên:

1. Bảo vệ dữ liệu Production.
2. Bảo đảm tính toàn vẹn dữ liệu.
3. Bảo đảm bảo mật thông tin.
4. Bảo đảm tương thích Frontend và Backend.
5. Tuân thủ kiến trúc hiện tại.
6. Thực hiện đúng yêu cầu người dùng.
7. Tối ưu hiệu năng và trải nghiệm khi phù hợp.

Không hy sinh dữ liệu, bảo mật hoặc tính ổn định của hệ thống chỉ để hoàn thành yêu cầu nhanh hơn.
