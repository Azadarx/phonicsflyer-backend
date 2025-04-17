// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: '*', // This will allow all origins for development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Alternative CORS setup if needed
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

app.use(bodyParser.json());

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Store user registrations temporarily (in production use a database)
const registrations = new Map();
// Store confirmed payments
const confirmedPayments = new Set();

// Razorpay configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Function to send confirmation emails
async function sendConfirmationEmails(userData, referenceId, transactionId) {
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
            
            <p>If you have any questions before the masterclass, feel free to reply to this email or reach out on WhatsApp: <a href="https://wa.me/919951611674">Click here to chat on WhatsApp</a></p>
            
            <p>Looking forward to helping you transform your life!</p>
            
            <p style="margin-bottom: 0;">Warm regards,</p>
            <p style="margin-top: 5px;"><strong>Inspiring Shereen</strong></p>
            <p style="color: #7C3AED;">Life Coach | Shaping Lives With Holistic Success</p>
            
            <div style="text-align: center; margin-top: 20px;">
                <a href="https://wa.me/919951611674" style="display: inline-block; background-color: #25D366; color: white; text-decoration: none; padding: 10px 20px; border-radius: 5px; font-weight: bold;">
                    Connect on WhatsApp
                </a>
            </div>
        </div>
        `
    };

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
            <li><strong>Reference ID:</strong> ${referenceId}</li>
            <li><strong>Transaction ID:</strong> ${transactionId}</li>
            <li><strong>Amount Paid:</strong> ₹99</li>
            </ul>
            
            <p><a href="https://wa.me/${userData.phone.replace(/\D/g, '')}">Contact participant on WhatsApp</a></p>
        </div>
        `
    };

    try {
        await transporter.sendMail(userMailOptions);
        await transporter.sendMail(adminMailOptions);
        return true;
    } catch (emailError) {
        console.error('Email sending error:', emailError);
        return false;
    }
}

// Function to verify Razorpay signature
function verifyRazorpaySignature(orderId, paymentId, signature) {
    const generatedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(orderId + '|' + paymentId)
        .digest('hex');
    
    return generatedSignature === signature;
}

// API Routes
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, phone } = req.body;

        if (!fullName || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const referenceId = crypto.randomBytes(6).toString('hex');
        const timestamp = Date.now();

        registrations.set(referenceId, {
            fullName,
            email,
            phone,
            timestamp,
            paymentConfirmed: false
        });

        res.json({
            success: true,
            referenceId: referenceId
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

app.post('/api/create-payment-order', async (req, res) => {
    try {
        const { referenceId } = req.body;

        if (!referenceId) {
            return res.status(400).json({ error: 'Reference ID is required' });
        }

        if (!registrations.has(referenceId)) {
            return res.status(404).json({ error: 'Invalid reference ID' });
        }

        const userData = registrations.get(referenceId);
        
        // Get Razorpay instance (using axios to create order)
        const orderData = {
            amount: 9900, // amount in paisa (99 INR)
            currency: "INR",
            receipt: `receipt_${referenceId}`,
            notes: {
                referenceId: referenceId,
                customerName: userData.fullName,
                customerEmail: userData.email,
                customerPhone: userData.phone
            }
        };

        try {
            // Create Razorpay order using Razorpay API
            const response = await axios.post(
                'https://api.razorpay.com/v1/orders',
                orderData,
                {
                    auth: {
                        username: RAZORPAY_KEY_ID,
                        password: RAZORPAY_KEY_SECRET
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const { id: orderId } = response.data;
            
            // Store order ID in user data
            userData.orderId = orderId;
            registrations.set(referenceId, userData);

            res.json({
                success: true,
                orderId: orderId,
                razorpayKey: RAZORPAY_KEY_ID
            });
        } catch (apiError) {
            console.error('Razorpay API error:', apiError.response?.data || apiError.message);
            res.status(500).json({
                error: 'Failed to create payment order',
                details: apiError.response?.data?.error?.description || apiError.message
            });
        }
    } catch (error) {
        console.error('Payment order creation error:', error);
        res.status(500).json({
            error: 'Server error while creating payment order'
        });
    }
});

app.get('/api/check-payment', (req, res) => {
    try {
        const referenceId = req.query.reference_id;

        if (!referenceId) {
            return res.status(400).json({
                success: false,
                error: 'Reference ID is required'
            });
        }

        if (confirmedPayments.has(referenceId)) {
            res.json({ success: true });
        } else if (registrations.has(referenceId)) {
            res.json({
                success: false,
                status: 'PENDING',
                message: 'Payment is being processed'
            });
        } else {
            res.json({
                success: false,
                status: 'UNKNOWN',
                message: 'Invalid reference ID'
            });
        }
    } catch (error) {
        console.error('Check payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error while checking payment'
        });
    }
});

app.post('/api/confirm-payment', async (req, res) => {
    try {
        const { 
            razorpay_payment_id, 
            razorpay_order_id, 
            razorpay_signature, 
            referenceId 
        } = req.body;

        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !referenceId) {
            return res.status(400).json({ 
                error: 'Payment details are incomplete' 
            });
        }

        // Verify the signature
        const isSignatureValid = verifyRazorpaySignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isSignatureValid) {
            return res.status(400).json({ 
                error: 'Invalid payment signature' 
            });
        }

        if (!registrations.has(referenceId)) {
            return res.status(404).json({ 
                error: 'Invalid reference ID' 
            });
        }

        const userData = registrations.get(referenceId);
        userData.paymentConfirmed = true;
        userData.transactionId = razorpay_payment_id;
        registrations.set(referenceId, userData);
        confirmedPayments.add(referenceId);

        // Send confirmation emails
        await sendConfirmationEmails(userData, referenceId, razorpay_payment_id);
        
        res.json({ 
            success: true, 
            referenceId 
        });
    } catch (error) {
        console.error('Payment confirmation error:', error);
        res.status(500).json({ 
            error: 'Something went wrong during payment confirmation' 
        });
    }
});

app.post('/api/razorpay-webhook', async (req, res) => {
    try {
        const webhookData = req.body;
        console.log('Received Razorpay webhook:', JSON.stringify(webhookData));

        // Verify webhook signature
        const webhookSignature = req.headers['x-razorpay-signature'];
        
        if (webhookSignature) {
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
            
            if (webhookSecret) {
                const generatedSignature = crypto
                    .createHmac('sha256', webhookSecret)
                    .update(JSON.stringify(req.body))
                    .digest('hex');
                
                if (generatedSignature !== webhookSignature) {
                    console.error('Invalid webhook signature');
                    return res.status(401).json({ success: false, error: 'Invalid signature' });
                }
            }
        }

        // Process payment success - ONLY sending emails for successful payment events
        if (webhookData.event === 'payment.captured' || webhookData.event === 'payment.authorized') {
            const paymentData = webhookData.payload.payment.entity;
            const orderId = paymentData.order_id;
            const paymentId = paymentData.id;
            
            // Find the reference ID from the order ID
            let referenceId = null;
            for (const [key, value] of registrations.entries()) {
                if (value.orderId === orderId) {
                    referenceId = key;
                    break;
                }
            }
            
            if (referenceId) {
                const userData = registrations.get(referenceId);
                userData.paymentConfirmed = true;
                userData.transactionId = paymentId;
                registrations.set(referenceId, userData);
                confirmedPayments.add(referenceId);
                
                // Send confirmation emails ONLY for successful payments
                try {
                    await sendConfirmationEmails(userData, referenceId, paymentId);
                    console.log(`Confirmation emails sent for reference ID: ${referenceId}`);
                } catch (emailError) {
                    console.error(`Failed to send confirmation emails for ${referenceId}:`, emailError);
                }
            } else {
                console.error(`Could not find referenceId for order ${orderId}`);
            }
        } else if (webhookData.event === 'payment.failed') {
            console.log('Payment failed - no emails will be sent');
            // Do not send any emails for failed payments
        }
        
        // Always return 200 for webhooks to acknowledge receipt
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Always return 200 for webhooks to prevent retries
        res.status(200).json({ success: true });
    }
});
// Basic routes
app.get('/api', (req, res) => {
    res.json({ message: 'API is running' });
});

app.get('/status', (req, res) => {
    res.json({ status: 'Server is running' });
});

app.get('/', (req, res) => {
    res.send('Server is running. API available at /api endpoints.');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});