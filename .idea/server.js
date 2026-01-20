// server/server.js - SERVER CHÍNH
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const { sendOTPEmail } = require('./utils/emailService');
const { processImageWithAI } = require('./utils/ocrService');

const app = express();

// Cấu hình CORS để frontend có thể gọi API
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình lưu file tạm
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Lưu trữ OTP tạm thời (trong production dùng Redis)
const otpStore = new Map();

// ==================== MIDDLEWARE ====================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token không hợp lệ' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token đã hết hạn' });
        }
        req.user = user;
        next();
    });
};

// ==================== API ENDPOINTS ====================

// 1. API ĐĂNG KÝ - GỬI OTP
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email } = req.body;

        // Validate email format
        const emailRegex = /^[^\s@]+@gmail\.com$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Email phải có định dạng @gmail.com'
            });
        }

        // Kiểm tra email đã tồn tại
        const userPath = path.join(__dirname, 'users', `${email}.json`);
        try {
            await fs.access(userPath);
            return res.status(400).json({
                error: 'Email đã được đăng ký'
            });
        } catch (err) {
            // File không tồn tại, tiếp tục
        }

        // Tạo OTP 6 số
        const otp = Math.floor(100000 + Math.random() * 900000);
        const expiresAt = Date.now() + 2 * 60 * 1000; // 2 phút

        // Lưu OTP
        otpStore.set(email, { otp, expiresAt });

        console.log(`OTP cho ${email}: ${otp} (hết hạn: ${new Date(expiresAt).toLocaleTimeString()})`);

        // Gửi email OTP (trong production)
        await sendOTPEmail(email, otp);

        res.json({
            success: true,
            message: 'Mã OTP đã được gửi đến email của bạn',
            expiresIn: 120 // 120 giây
        });

    } catch (error) {
        console.error('Lỗi gửi OTP:', error);
        res.status(500).json({ error: 'Không thể gửi OTP' });
    }
});

// 2. API XÁC THỰC OTP & TẠO TÀI KHOẢN
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, otp } = req.body;

        // Kiểm tra OTP
        const otpData = otpStore.get(email);
        if (!otpData) {
            return res.status(400).json({ error: 'Mã OTP không tồn tại hoặc đã hết hạn' });
        }

        if (otpData.otp !== parseInt(otp)) {
            return res.status(400).json({ error: 'Mã OTP không chính xác' });
        }

        if (Date.now() > otpData.expiresAt) {
            otpStore.delete(email);
            return res.status(400).json({ error: 'Mã OTP đã hết hạn' });
        }

        // Xóa OTP đã dùng
        otpStore.delete(email);

        // Tạo thư mục users nếu chưa tồn tại
        const usersDir = path.join(__dirname, 'users');
        await fs.mkdir(usersDir, { recursive: true });

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Tạo file người dùng
        const userData = {
            email,
            passwordHash,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            quizzes: [],
            stats: {
                totalQuizzes: 0,
                totalQuestions: 0,
                totalPlays: 0,
                bestScore: 0
            }
        };

        const userPath = path.join(usersDir, `${email}.json`);
        await fs.writeFile(userPath, JSON.stringify(userData, null, 2));

        // Tạo JWT token
        const token = jwt.sign(
            {
                email: email,
                createdAt: userData.createdAt
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Đăng ký thành công!',
            token,
            user: {
                email: email,
                createdAt: userData.createdAt
            }
        });

    } catch (error) {
        console.error('Lỗi đăng ký:', error);
        res.status(500).json({ error: 'Không thể đăng ký tài khoản' });
    }
});

// 3. API ĐĂNG NHẬP
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Đọc file người dùng
        const userPath = path.join(__dirname, 'users', `${email}.json`);
        let userData;

        try {
            const fileContent = await fs.readFile(userPath, 'utf8');
            userData = JSON.parse(fileContent);
        } catch (err) {
            return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
        }

        // Kiểm tra password
        const isValidPassword = await bcrypt.compare(password, userData.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
        }

        // Cập nhật thời gian đăng nhập
        userData.updatedAt = new Date().toISOString();
        await fs.writeFile(userPath, JSON.stringify(userData, null, 2));

        // Tạo token mới
        const token = jwt.sign(
            {
                email: userData.email,
                createdAt: userData.createdAt
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Đăng nhập thành công!',
            token,
            user: {
                email: userData.email,
                createdAt: userData.createdAt,
                stats: userData.stats
            }
        });

    } catch (error) {
        console.error('Lỗi đăng nhập:', error);
        res.status(500).json({ error: 'Không thể đăng nhập' });
    }
});

// 4. API XỬ LÝ ẢNH VỚI AI (PHÂN TÍCH CÂU HỎI TỪ ẢNH)
app.post('/api/ai/process-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Không có ảnh được tải lên' });
        }

        // Giới hạn 10 ảnh cùng lúc
        const files = req.files ? req.files.images || [] : [];
        if (files.length > 10) {
            return res.status(400).json({ error: 'Chỉ được upload tối đa 10 ảnh' });
        }

        console.log(`Nhận ${files.length + 1} ảnh để xử lý`);

        // Xử lý từng ảnh với AI
        const results = [];

        // Xử lý ảnh chính
        const mainImageResult = await processImageWithAI(req.file.buffer);
        results.push({
            fileName: req.file.originalname,
            ...mainImageResult
        });

        // Xử lý các ảnh bổ sung nếu có
        for (let i = 0; i < Math.min(files.length, 9); i++) {
            const file = files[i];
            const result = await processImageWithAI(file.buffer);
            results.push({
                fileName: file.originalname,
                ...result
            });
        }

        res.json({
            success: true,
            message: `Đã xử lý ${results.length} ảnh`,
            results,
            processedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Lỗi xử lý ảnh:', error);
        res.status(500).json({
            error: 'Không thể xử lý ảnh',
            details: error.message
        });
    }
});

// 5. API LƯU QUIZ CỦA NGƯỜI DÙNG
app.post('/api/user/save-quiz', authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const quizData = req.body;

        if (!quizData || !quizData.questions || quizData.questions.length === 0) {
            return res.status(400).json({ error: 'Dữ liệu quiz không hợp lệ' });
        }

        // Đọc file người dùng
        const userPath = path.join(__dirname, 'users', `${email}.json`);
        const fileContent = await fs.readFile(userPath, 'utf8');
        const userData = JSON.parse(fileContent);

        // Tạo quiz mới
        const newQuiz = {
            id: `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title: quizData.title || `Quiz ${new Date().toLocaleDateString()}`,
            questions: quizData.questions,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: quizData.tags || [],
            isPublic: quizData.isPublic || false
        };

        // Thêm quiz vào danh sách
        userData.quizzes.push(newQuiz);

        // Cập nhật thống kê
        userData.stats.totalQuizzes = userData.quizzes.length;
        userData.stats.totalQuestions += newQuiz.questions.length;
        userData.updatedAt = new Date().toISOString();

        // LƯU FILE - GHI ĐÈ TOÀN BỘ DỮ LIỆU
        await fs.writeFile(userPath, JSON.stringify(userData, null, 2));

        res.json({
            success: true,
            message: 'Đã lưu quiz thành công',
            quizId: newQuiz.id,
            stats: userData.stats
        });

    } catch (error) {
        console.error('Lỗi lưu quiz:', error);
        res.status(500).json({ error: 'Không thể lưu quiz' });
    }
});

// 6. API LẤY DANH SÁCH QUIZ CỦA NGƯỜI DÙNG
app.get('/api/user/quizzes', authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;

        const userPath = path.join(__dirname, 'users', `${email}.json`);
        const fileContent = await fs.readFile(userPath, 'utf8');
        const userData = JSON.parse(fileContent);

        res.json({
            success: true,
            quizzes: userData.quizzes,
            stats: userData.stats
        });

    } catch (error) {
        console.error('Lỗi đọc quizzes:', error);
        res.status(500).json({ error: 'Không thể lấy danh sách quiz' });
    }
});

// 7. API XÓA QUIZ
app.delete('/api/user/quiz/:quizId', authenticateToken, async (req, res) => {
    try {
        const { email } = req.user;
        const { quizId } = req.params;

        const userPath = path.join(__dirname, 'users', `${email}.json`);
        const fileContent = await fs.readFile(userPath, 'utf8');
        const userData = JSON.parse(fileContent);

        // Tìm và xóa quiz
        const initialLength = userData.quizzes.length;
        userData.quizzes = userData.quizzes.filter(quiz => quiz.id !== quizId);

        if (userData.quizzes.length === initialLength) {
            return res.status(404).json({ error: 'Không tìm thấy quiz' });
        }

        // Cập nhật thống kê
        userData.stats.totalQuizzes = userData.quizzes.length;
        userData.updatedAt = new Date().toISOString();

        // Lưu file đã cập nhật
        await fs.writeFile(userPath, JSON.stringify(userData, null, 2));

        res.json({
            success: true,
            message: 'Đã xóa quiz thành công',
            stats: userData.stats
        });

    } catch (error) {
        console.error('Lỗi xóa quiz:', error);
        res.status(500).json({ error: 'Không thể xóa quiz' });
    }
});

// 8. API KIỂM TRA TOKEN
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

// ==================== KHỞI ĐỘNG SERVER ====================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
    console.log(`📁 Dữ liệu người dùng: ${path.join(__dirname, 'users')}`);
});