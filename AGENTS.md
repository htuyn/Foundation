---

# Neon PostgreSQL MCP và quản lý Database

## 1. Nguyên tắc kết nối

- Sử dụng Neon MCP để AI có thể đọc, phân tích và thao tác database khi người dùng yêu cầu.
- Trước khi thao tác, kiểm tra MCP `neon-foundation` đã kết nối thành công hay chưa.
- Luôn xác định đúng Neon Project, branch và database trước khi thực hiện truy vấn.
- Ưu tiên đúng database và branch mà ứng dụng Foundation đang sử dụng.
- Không mặc định database đang kết nối là Production hoặc Development nếu chưa xác minh.
- Nếu MCP chưa kết nối, thông báo rõ và hướng dẫn người dùng kết nối; không giả vờ đã truy cập database.
- Không tự ý chuyển sang database khác khi gặp lỗi kết nối.

## 2. Quyền truy cập và bảo mật

- Chỉ sử dụng quyền truy cập cần thiết cho nhiệm vụ.
- Không yêu cầu hoặc sử dụng tài khoản Neon Owner nếu không thực sự cần thiết.
- Không tiết lộ mật khẩu, connection string, API key, token OAuth hoặc thông tin xác thực.
- Không đưa thông tin đăng nhập vào source code, `AGENTS.md`, Memory Bank hoặc GitHub.
- Không commit file `.env` hoặc các file chứa thông tin bí mật.
- Kiểm tra `.gitignore` để bảo đảm các file môi trường được loại trừ.
- Không in toàn bộ thông tin kết nối database ra terminal hoặc log.
- Không chia sẻ tài khoản database cá nhân giữa các thành viên.
- Mỗi thành viên nên sử dụng tài khoản và quyền truy cập riêng.

## 3. Quy tắc đọc Database

Trước khi chỉnh sửa bất kỳ dữ liệu hoặc cấu trúc nào, phải kiểm tra database thực tế qua Neon MCP.

AI cần có khả năng:

- Liệt kê database schema và các bảng.
- Đọc tên cột, kiểu dữ liệu và giá trị mặc định.
- Kiểm tra Primary Key và Foreign Key.
- Kiểm tra các quan hệ giữa bảng.
- Kiểm tra Index và Constraint.
- Đọc dữ liệu cần thiết để phân tích nghiệp vụ.
- Kiểm tra dữ liệu trùng lặp, thiếu hoặc không hợp lệ.
- Đối chiếu cấu trúc database với SQLAlchemy models.
- Đối chiếu lịch sử thay đổi với Alembic migrations.

Không được:

- Tự đoán tên bảng hoặc tên cột.
- Tự giả định quan hệ giữa các bảng.
- Tự tạo dữ liệu mẫu để thay thế dữ liệu thật khi chưa được yêu cầu.
- Đọc hoặc xuất dữ liệu nhạy cảm không liên quan đến nhiệm vụ.
- Truy vấn dữ liệu hàng loạt không cần thiết.

## 4. Quy tắc thêm, sửa và xóa dữ liệu

Khi người dùng yêu cầu thay đổi dữ liệu database:

1. Kiểm tra bảng và cấu trúc liên quan.
2. Xác định chính xác bản ghi cần thay đổi.
3. Kiểm tra các khóa ngoại và quan hệ phụ thuộc.
4. Đánh giá ảnh hưởng đến nghiệp vụ.
5. Trình bày nội dung sẽ thay đổi nếu có rủi ro đáng kể.
6. Chỉ thực hiện đúng phạm vi được yêu cầu.
7. Kiểm tra lại dữ liệu sau khi thực hiện.

### Quy tắc bắt buộc

- Không tự ý thêm dữ liệu giả vào Production.
- Không tự ý sửa dữ liệu của người dùng.
- Không tự ý xóa bản ghi.
- Không tự ý chạy UPDATE hoặc DELETE trên diện rộng.
- Không sử dụng DROP, TRUNCATE hoặc xóa hàng loạt nếu chưa được người dùng xác nhận rõ ràng.
- Không thay đổi dữ liệu ngoài phạm vi yêu cầu.
- Ưu tiên transaction khi thực hiện nhiều thay đổi có liên quan.
- Nếu có thể, kiểm tra kết quả trước khi COMMIT.
- Nếu thao tác thất bại, kiểm tra trạng thái transaction và báo cáo chính xác.

## 5. Quy trình thay đổi cấu trúc Database

Đối với Foundation, mọi thay đổi cấu trúc database phải được quản lý bằng SQLAlchemy và Alembic.

### Khi thêm bảng hoặc cột

Thực hiện theo thứ tự:

1. Kiểm tra schema hiện tại trên Neon.
2. Kiểm tra SQLAlchemy models trong Backend.
3. Kiểm tra các migration Alembic đã tồn tại.
4. Xác định thay đổi cần thiết.
5. Cập nhật SQLAlchemy models.
6. Tạo Alembic migration mới.
7. Kiểm tra nội dung migration được sinh ra.
8. Đánh giá ảnh hưởng đến dữ liệu hiện tại.
9. Kiểm tra trên môi trường Development trước.
10. Chỉ chạy migration trên Production sau khi người dùng phê duyệt.
11. Kiểm tra schema và trạng thái Alembic sau migration.

### Khi sửa hoặc xóa cột

- Kiểm tra toàn bộ code Backend đang sử dụng cột đó.
- Kiểm tra API và Frontend có phụ thuộc vào dữ liệu đó hay không.
- Kiểm tra dữ liệu hiện tại có bị mất hoặc biến đổi không.
- Kiểm tra khóa ngoại, Index, Constraint và các truy vấn liên quan.
- Ưu tiên migration nhiều giai đoạn nếu thay đổi có nguy cơ gây gián đoạn.
- Không xóa cột ngay khi chưa xác định các thành phần phụ thuộc.

### Quy định Alembic

- Không chỉnh sửa migration cũ đã được áp dụng trên môi trường dùng chung hoặc Production.
- Tạo migration mới để thay đổi schema.
- Không tự ý xóa lịch sử migration.
- Không tự ý sửa bảng `alembic_version`.
- Không chạy `alembic upgrade head` trên Production khi chưa được người dùng phê duyệt.
- Không tự ý chạy `alembic downgrade` trên Production.
- Phải kiểm tra nội dung migration trước khi áp dụng.
- Nếu migration có nguy cơ mất dữ liệu, phải cảnh báo và yêu cầu xác nhận.

## 6. Đồng bộ Database với Backend và Frontend

Khi thay đổi database, phải kiểm tra các thành phần liên quan.

### Backend

- SQLAlchemy models.
- Pydantic schemas.
- API endpoints.
- CRUD operations.
- Services và business logic.
- Repository nếu dự án sử dụng.
- Validation và transaction.
- Các truy vấn SQL liên quan.

### Frontend

- TypeScript interfaces và types.
- API services.
- Form nhập liệu.
- Component hiển thị dữ liệu.
- Bảng dữ liệu và bộ lọc.
- Các chức năng thêm, sửa, xóa.
- Xử lý trạng thái loading và error.

### Nguyên tắc

- Database, Backend và Frontend phải thống nhất về cấu trúc và ý nghĩa dữ liệu.
- Không chỉ sửa database mà bỏ qua Backend.
- Không chỉ sửa Backend mà bỏ qua Frontend nếu API contract thay đổi.
- Không tự ý đổi tên API hoặc trường dữ liệu đang được sử dụng.
- Phải kiểm tra tương thích ngược khi thay đổi API hoặc schema.

## 7. Quy trình làm việc khi Vibe Coding

Khi người dùng yêu cầu AI thêm, sửa hoặc phân tích một chức năng có liên quan đến database, thực hiện theo quy trình:

### Giai đoạn 1: Khảo sát

- Đọc Memory Bank.
- Kiểm tra cấu trúc source code.
- Kiểm tra Neon MCP.
- Đọc schema và dữ liệu thực tế cần thiết.
- Kiểm tra SQLAlchemy models và Alembic migrations.
- Xác định các API và Frontend liên quan.

### Giai đoạn 2: Phân tích

- Xác định vấn đề hoặc chức năng cần triển khai.
- Xác định những bảng và cột liên quan.
- Xác định những file code cần sửa.
- Đánh giá ảnh hưởng đến dữ liệu hiện có.
- Xác định rủi ro và phương án kiểm tra.

### Giai đoạn 3: Lập kế hoạch

- Đưa ra phương án triển khai.
- Liệt kê các file dự kiến chỉnh sửa.
- Xác định có cần migration hay không.
- Xác định có cần thay đổi API hay không.
- Xác định có cần thay đổi Frontend hay không.
- Thông báo nếu thao tác ảnh hưởng Production hoặc dữ liệu hiện có.

### Giai đoạn 4: Thực hiện

- Chỉ chỉnh sửa những phần cần thiết.
- Tuân thủ kiến trúc và coding convention hiện tại.
- Sử dụng Alembic khi thay đổi cấu trúc database.
- Sử dụng Neon MCP đúng phạm vi quyền được cấp.
- Không tự ý thực hiện thao tác nguy hiểm trên Production.
- Không thay đổi các phần ngoài yêu cầu.

### Giai đoạn 5: Kiểm tra

- Kiểm tra cú pháp và import.
- Kiểm tra Backend.
- Kiểm tra Frontend nếu có thay đổi.
- Kiểm tra migration.
- Kiểm tra schema Neon sau khi được phép áp dụng.
- Kiểm tra dữ liệu trước và sau thay đổi.
- Kiểm tra các chức năng liên quan không bị ảnh hưởng.

### Giai đoạn 6: Báo cáo

Báo cáo bằng tiếng Việt, bao gồm:

- Vấn đề ban đầu.
- Nguyên nhân.
- Các file đã thay đổi.
- Các bảng hoặc cột database bị ảnh hưởng.
- Migration đã tạo hay chưa.
- Migration đã chạy ở môi trường nào.
- Các kiểm tra đã thực hiện.
- Kết quả thực tế.
- Những phần còn hạn chế hoặc chưa hoàn thành.

## 8. Phân biệt môi trường Database

Phải phân biệt rõ:

**Local**

- Database PostgreSQL chạy trên máy hoặc Docker của nhà phát triển.
- Chỉ ảnh hưởng dữ liệu local.
- Không mặc định đồng bộ với Neon.

**Neon Development**

- Dùng để phát triển và thử nghiệm.
- Ưu tiên kiểm tra migration và thay đổi dữ liệu tại đây trước Production.

**Neon Production**

- Database thực tế của ứng dụng.
- Mọi thay đổi phải được kiểm soát.
- Không tự ý thử nghiệm, xóa dữ liệu hoặc chạy migration nguy hiểm.
- Cần có xác nhận của người dùng trước các thay đổi cấu trúc hoặc dữ liệu có rủi ro.

Không được tuyên bố dữ liệu local đã cập nhật lên Neon nếu chưa thực sự đồng bộ.

## 9. Backup và phục hồi

Trước những thay đổi Production có nguy cơ mất dữ liệu:

- Kiểm tra trạng thái backup gần nhất.
- Xác định khả năng phục hồi.
- Xem xét sử dụng Neon branching hoặc quy trình backup hiện có.
- Không mặc định rằng có backup đồng nghĩa với việc phục hồi chắc chắn thành công.
- Không ghi đè dữ liệu Production khi chưa xác định rõ phương án phục hồi.
- Không tự ý thực hiện restore trên Production.
- Sau khi phục hồi, phải kiểm tra tính toàn vẹn và khả năng hoạt động của ứng dụng.

## 10. Quy tắc triển khai

### Frontend

- Kiểm tra build trước khi triển khai.
- Không đưa secret vào biến môi trường public.
- Không tự ý thay đổi cấu hình Vercel ngoài phạm vi yêu cầu.

### Backend

- Kiểm tra API và cấu hình môi trường.
- Không đưa secret vào source code.
- Kiểm tra kết nối Neon và cấu hình CORS.
- Không tự ý thay đổi cấu hình Render Production.

### Database

- Không mặc định Git push sẽ cập nhật schema Neon.
- Không mặc định Vercel hoặc Render tự chạy migration.
- Migration phải được thực hiện theo quy trình riêng.
- Phải xác minh kết quả sau triển khai.

## 11. Cập nhật Memory Bank

Sau khi hoàn thành thay đổi liên quan đến database hoặc kiến trúc:

- Cập nhật `activeContext.md`.
- Cập nhật `progress.md`.
- Cập nhật tài liệu kiến trúc hoặc database nếu có.
- Ghi lại migration mới và mục đích của nó.
- Ghi rõ trạng thái đã triển khai hay chưa.
- Ghi rõ môi trường đã được cập nhật.
- Không ghi mật khẩu, connection string hoặc token vào Memory Bank.

## 12. Nguyên tắc ưu tiên cao nhất

Khi có xung đột giữa tốc độ triển khai và tính an toàn:

1. Bảo vệ dữ liệu Production.
2. Bảo đảm tính toàn vẹn dữ liệu.
3. Bảo đảm tính tương thích Backend và Frontend.
4. Tuân thủ kiến trúc hiện tại.
5. Thực hiện đúng yêu cầu người dùng.
6. Tối ưu hiệu năng và trải nghiệm khi phù hợp.

Không được tự ý hy sinh dữ liệu, bảo mật hoặc tính ổn định của hệ thống chỉ để hoàn thành yêu cầu nhanh hơn.
