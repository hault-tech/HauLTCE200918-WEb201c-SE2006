// server/utils/emailService.js - GỬI EMAIL OTP
const nodemailer = require('nodemailer');

// Cấu hình email (sử dụng Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'your-email@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

/**
 * Gửi mã OTP đến email người dùng
 */
async function sendOTPEmail(email, otp) {
    try {
        const mailOptions = {
            from: `"Flashcard Quiz AI" <${process.env.EMAIL_USER || 'your-email@gmail.com'}>`,
            to: email,
            subject: 'Mã OTP Đăng ký - Flashcard Quiz AI',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4361ee;">Flashcard Quiz AI</h2>
                    <p>Chào bạn,</p>
                    <p>Đây là mã OTP để đăng ký tài khoản của bạn:</p>
                    <div style="background: #f8f9ff; padding: 20px; text-align: center; margin: 20px 0; border-radius: 10px; border: 2px dashed #4361ee;">
                        <h1 style="color: #4361ee; margin: 0; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
                    </div>
                    <p><strong>Mã có hiệu lực trong 2 phút</strong></p>
                    <p>Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email này.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                    <p style="color: #666; font-size: 12px;">Đây là email tự động, vui lòng không trả lời.</p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Đã gửi OTP đến ${email}: ${info.messageId}`);
        return true;

    } catch (error) {
        console.error('❌ Lỗi gửi email:', error);

        // Fallback: Nếu không gửi được email, log ra console (dành cho development)
        console.log(`[DEVELOPMENT] OTP cho ${email}: ${otp}`);
        return true; // Vẫn trả về true để tiếp tục flow
    }
}

module.exports = { sendOTPEmail };