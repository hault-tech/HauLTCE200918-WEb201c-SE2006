// server/utils/ocrService.js - XỬ LÝ ẢNH VỚI AI
const Tesseract = require('tesseract.js');
const axios = require('axios');

/**
 * Xử lý ảnh với AI - Kết hợp nhiều phương pháp
 */
async function processImageWithAI(imageBuffer) {
    try {
        // PHƯƠNG PHÁP 1: Sử dụng Tesseract.js (Miễn phí, local)
        const tesseractResult = await processWithTesseract(imageBuffer);

        // PHƯƠNG PHÁP 2: Gọi API AI bên ngoài (nếu có key)
        let aiResult = null;
        if (process.env.EDENAI_API_KEY) {
            try {
                aiResult = await processWithEdenAI(imageBuffer);
            } catch (aiError) {
                console.warn('API AI thất bại, dùng kết quả Tesseract');
            }
        }

        // Kết hợp hoặc chọn kết quả tốt nhất
        const finalText = aiResult?.text || tesseractResult.text;

        // Phân tích câu hỏi và đáp án từ text
        const analyzedData = analyzeQuizContent(finalText);

        return {
            success: true,
            text: finalText,
            ...analyzedData,
            confidence: aiResult?.confidence || tesseractResult.confidence,
            processedWith: aiResult ? 'EdenAI + Tesseract' : 'Tesseract'
        };

    } catch (error) {
        console.error('Lỗi xử lý ảnh:', error);
        throw new Error('Không thể xử lý ảnh: ' + error.message);
    }
}

/**
 * Xử lý với Tesseract.js (Local)
 */
async function processWithTesseract(imageBuffer) {
    try {
        const { data: { text, confidence } } = await Tesseract.recognize(
            imageBuffer,
            'vie+eng', // Hỗ trợ tiếng Việt và Anh
            {
                logger: m => console.log('Tesseract:', m.status)
            }
        );

        return {
            text: text.trim(),
            confidence: confidence,
            source: 'tesseract'
        };
    } catch (error) {
        console.error('Tesseract error:', error);
        return {
            text: '',
            confidence: 0,
            source: 'tesseract-error'
        };
    }
}

/**
 * Xử lý với Eden AI API (Nhanh hơn, chính xác hơn)
 */
async function processWithEdenAI(imageBuffer) {
    const apiKey = process.env.EDENAI_API_KEY;
    if (!apiKey) {
        throw new Error('EdenAI API key not configured');
    }

    const base64Image = imageBuffer.toString('base64');

    const response = await axios.post(
        'https://api.edenai.run/v2/ocr/ocr',
        {
            providers: 'google', // Có thể dùng 'amazon', 'microsoft', 'google'
            file: base64Image,
            language: 'vi'
        },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const result = response.data?.google || response.data?.amazon;
    if (!result) {
        throw new Error('No result from AI service');
    }

    return {
        text: result.text || '',
        confidence: result.confidence || 0.9,
        source: 'edenai'
    };
}

/**
 * Phân tích text để tìm câu hỏi và đáp án
 */
function analyzeQuizContent(text) {
    const lines = text.split('\n').filter(line => line.trim().length > 0);

    let question = '';
    const options = [];
    let correctAnswer = '';

    // Logic phân tích cải tiến
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Tìm câu hỏi (dòng có dấu ? hoặc chứa "Câu", "Question")
        if ((line.includes('?') || line.includes('Câu') || line.toLowerCase().includes('question')) && !question) {
            question = line;
        }

        // Tìm đáp án (A., B., C., D. hoặc 1., 2., 3., 4.)
        const optionMatch = line.match(/^([A-Da-d1-4])[\.\)]\s*(.+)$/);
        if (optionMatch) {
            options.push(optionMatch[2].trim());

            // Mặc định đáp án A là đúng (người dùng có thể chỉnh sau)
            if (optionMatch[1].toUpperCase() === 'A') {
                correctAnswer = optionMatch[2].trim();
            }
        }
    }

    // Fallback: Nếu không tìm thấy câu hỏi, lấy dòng đầu tiên
    if (!question && lines.length > 0) {
        question = lines[0];
    }

    // Fallback: Nếu không tìm thấy đáp án, tạo placeholder
    if (options.length === 0) {
        options.push('Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D');
        correctAnswer = options[0];
    }

    return {
        question,
        options,
        correctAnswer,
        totalLines: lines.length
    };
}

module.exports = { processImageWithAI };