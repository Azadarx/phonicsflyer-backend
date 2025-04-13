// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_SECRET
});

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Store successful payments temporarily (in production use a database)
const successfulPayments = new Set();

// API to create Razorpay order
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, phone } = req.body;

        // Validate input
        if (!fullName || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Create Razorpay order
        const options = {
            amount: 9900,// 99 rupees in paise
            currency: 'INR',
            receipt: `receipt_${Date.now()}`
        };

        const order = await razorpay.orders.create(options);

        // Store user data temporarily (in production use a database)
        app.locals[order.id] = { fullName, email, phone };

        res.json({
            orderId: order.id,
            amount: order.amount
        });

    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// API to verify payment
app.post('/api/verify-payment', async (req, res) => {
    try {
        const {
            razorpay_payment_id,
            razorpay_order_id,
            razorpay_signature
        } = req.body;

        // Verify signature
        const text = `${razorpay_order_id}|${razorpay_payment_id}`;
        const generated_signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_SECRET)
            .update(text)
            .digest('hex');

        if (generated_signature !== razorpay_signature) {
            return res.status(400).json({ success: false, error: 'Invalid signature' });
        }

        // Payment verified successfully
        successfulPayments.add(razorpay_payment_id);

        // Get user data
        const userData = app.locals[razorpay_order_id];

        if (userData) {
            // Send confirmation email to user
            const userMailOptions = {
                from: process.env.EMAIL_USER,
                to: userData.email,
                subject: 'Your Registration is Confirmed! - Inspiring Shereen Masterclass',
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
                    <h2 style="color: #7C3AED; text-align: center;">Thank You for Registering!</h2>
                    <p>Dear ${userData.fullName},</p>
                    <p>Your payment has been successfully processed and your spot in our <strong>Life-Changing 3-Hour Masterclass</strong> is confirmed! 🎉</p>
                    
                    <div style="background-color: #F5F3FF; padding: 15px; border-radius: 10px; margin: 20px 0;">
                      <h3 style="color: #7C3AED; margin-top: 0;">Event Details:</h3>
                      <p>📅 <strong>Date:</strong> April 19th</p>
                      <p>🕦 <strong>Time:</strong> 11:30 AM</p>
                      <p>📍 <strong>Location:</strong> Live on Zoom (Interactive + Reflective Exercises)</p>
                      <p>We'll send you the Zoom link and any additional instructions 24 hours before the event.</p>
                    </div>
                    
                    <p>Get ready to break free from stress, confusion & setbacks and take control of your life with clarity and confidence! ✨</p>
                    
                    <p>If you have any questions before the masterclass, feel free to reply to this email.</p>
                    
                    <p>Looking forward to helping you transform your life!</p>
                    
                    <p style="margin-bottom: 0;">Warm regards,</p>
                    <p style="margin-top: 5px;"><strong>Inspiring Shereen</strong></p>
                    <p style="color: #7C3AED;">Life Coach | Shaping Lives With Holistic Success</p>
                  </div>
                `
            };

            // Send email to admin
            const adminMailOptions = {
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_USER,
                subject: 'New Registration - Inspiring Shereen Masterclass',
                html: `
                  <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #7C3AED;">New Registration!</h2>
                    <p>A new participant has registered for the Life Coaching Masterclass:</p>
                    
                    <ul>
                      <li><strong>Full Name:</strong> ${userData.fullName}</li>
                      <li><strong>Email:</strong> ${userData.email}</li>
                      <li><strong>Phone:</strong> ${userData.phone}</li>
                      <li><strong>Payment ID:</strong> ${razorpay_payment_id}</li>
                      <li><strong>Order ID:</strong> ${razorpay_order_id}</li>
                      <li><strong>Amount Paid:</strong> ₹99</li>
                    </ul>
                  </div>
                `
            };

            try {
                await transporter.sendMail(userMailOptions);
                await transporter.sendMail(adminMailOptions);
            } catch (emailError) {
                console.error('Email sending error:', emailError);
                // Don't fail the request if email fails
            }

            // Clean up temporary data
            delete app.locals[razorpay_order_id];
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ success: false, error: 'Something went wrong' });
    }
});

// API endpoint to check if payment is authentic
app.get('/api/verify-payment', (req, res) => {
    const paymentId = req.query.payment_id;

    if (successfulPayments.has(paymentId)) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Important: Serve static files and catch-all route only in production
if (process.env.NODE_ENV === 'production') {
    // Serve static files
    app.use(express.static(path.join(__dirname, 'build')));
    
    // Catch-all route - this should be AFTER all API routes
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'build', 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});