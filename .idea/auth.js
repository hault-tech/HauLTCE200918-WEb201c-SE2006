// server/utils/auth.js - TIỆN ÍCH XÁC THỰC
const jwt = require('jsonwebtoken');

/**
 * Tạo JWT token cho người dùng
 */
function generateToken(userData) {
    return jwt.sign(
        {
            email: userData.email,
            userId: userData._id || userData.email,
            createdAt: userData.createdAt
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

/**
 * Kiểm tra tính hợp lệ của email
 */
function validateEmail(email) {
    const emailRegex = /^[^\s@]+@gmail\.com$/;
    return emailRegex.test(email);
}

/**
 * Kiểm tra độ mạnh của mật khẩu
 */
function validatePassword(password) {
    // Ít nhất 6 ký tự, có chữ và số
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{6,}$/;
    return passwordRegex.test(password);
}

module.exports = {
    generateToken,
    validateEmail,
    validatePassword
};