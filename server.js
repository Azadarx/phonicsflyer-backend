// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios'); // Make sure to install axios

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: function (origin, callback) {
        const allowedOrigins = [
            'https://inspiringshereen.vercel.app',
            'http://localhost:5173'
        ];
        
        // For browser preflight requests (OPTIONS), origin might be undefined
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`Blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle OPTIONS preflight requests explicitly
app.options('*', (req, res) => {
    res.status(200).end();
});

app.use(bodyParser.json());

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

// Cashfree configuration
const CASHFREE_BASE_URL = process.env.CASHFREE_ENVIRONMENT === 'PRODUCTION'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// Helper function to generate Cashfree headers
const getCashfreeHeaders = () => {
    return {
        'x-api-version': process.env.CASHFREE_API_VERSION || '2022-09-01',
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'Content-Type': 'application/json'
    };
};

// API to register a user and generate a unique reference ID
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, phone } = req.body;

        // Validate input
        if (!fullName || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Generate a unique reference ID
        const referenceId = crypto.randomBytes(6).toString('hex');
        const timestamp = Date.now();

        // Store user data
        registrations.set(referenceId, {
            fullName,
            email,
            phone,
            timestamp,
            paymentConfirmed: false
        });

        // Return reference ID and payment details
        res.json({
            success: true,
            referenceId: referenceId,
            paymentDetails: {
                upiId: "9494100110@yesbank",
                name: "Inspiring Shereen",
                amount: "99",
                currency: "INR"
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// Enhanced create-payment-order endpoint with better error handling
app.post('/api/create-payment-order', async (req, res) => {
    try {
        const { referenceId } = req.body;

        // Validate input
        if (!referenceId) {
            return res.status(400).json({ error: 'Reference ID is required' });
        }

        // Check if reference ID exists
        if (!registrations.has(referenceId)) {
            return res.status(404).json({ error: 'Invalid reference ID' });
        }

        const userData = registrations.get(referenceId);
        const orderId = `ORDER_${referenceId}_${Date.now()}`;

        // Create payment order with Cashfree
        const orderData = {
            order_id: orderId,
            order_amount: 99,
            order_currency: "INR",
            customer_details: {
                customer_id: referenceId,
                customer_name: userData.fullName,
                customer_email: userData.email,
                customer_phone: userData.phone
            },
            order_meta: {
                return_url: `${process.env.FRONTEND_URL || 'https://inspiringshereen.vercel.app'}/success?reference_id=${referenceId}`
            }
        };

        // Check if Cashfree credentials are configured
        if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
            console.error('Cashfree credentials not configured');
            return res.status(500).json({ error: 'Payment gateway configuration error' });
        }

        try {
            const response = await axios.post(
                `${CASHFREE_BASE_URL}/orders`,
                orderData,
                { headers: getCashfreeHeaders() }
            );

            // Store order ID with user data
            userData.orderId = orderId;
            registrations.set(referenceId, userData);

            res.json({
                success: true,
                orderId: orderId,
                paymentSessionId: response.data.payment_session_id,
                orderToken: response.data.order_token,
                appId: process.env.CASHFREE_APP_ID
            });
        } catch (apiError) {
            console.error('Cashfree API error:', apiError.response?.data || apiError.message);
            res.status(500).json({
                error: 'Failed to create payment order',
                details: apiError.response?.data?.message || apiError.message
            });
        }
    } catch (error) {
        console.error('Payment order creation error:', error);
        res.status(500).json({
            error: 'Server error while creating payment order'
        });
    }
});

// Enhanced check-payment-status endpoint
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
            // Payment pending but registration exists
            res.json({
                success: false,
                status: 'PENDING',
                message: 'Payment is being processed'
            });
        } else {
            // Unknown reference ID
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


// Function to send confirmation emails
async function sendConfirmationEmails(userData, referenceId, transactionId) {
    // Send to user
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

    // Send to admin
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

// Legacy API to confirm payment (keep for compatibility)
app.post('/api/confirm-payment', async (req, res) => {
    try {
        const { referenceId, transactionId } = req.body;

        // Validate input
        if (!referenceId || !transactionId) {
            return res.status(400).json({ error: 'Reference ID and Transaction ID are required' });
        }

        // Check if reference ID exists
        if (!registrations.has(referenceId)) {
            return res.status(404).json({ error: 'Invalid reference ID' });
        }

        const userData = registrations.get(referenceId);

        // Mark payment as confirmed
        userData.paymentConfirmed = true;
        userData.transactionId = transactionId;
        registrations.set(referenceId, userData);

        // Add to confirmed payments
        confirmedPayments.add(referenceId);

        // Send confirmation emails
        await sendConfirmationEmails(userData, referenceId, transactionId);

        res.json({ success: true, referenceId });

    } catch (error) {
        console.error('Payment confirmation error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// API endpoint to check if payment is confirmed
app.get('/api/check-payment', (req, res) => {
    const referenceId = req.query.reference_id;

    if (confirmedPayments.has(referenceId)) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Add a default route for the API
app.get('/api', (req, res) => {
    res.json({ message: 'API is running' });
});

// Add a simple status check route
app.get('/status', (req, res) => {
    res.json({ status: 'Server is running' });
});

// Default route to show server is working
app.get('/', (req, res) => {
    res.send('Server is running. API available at /api endpoints.');
});
// Cashfree webhook handler
// Update the Cashfree webhook handler in server.js
// Updated Cashfree webhook handler in server.js
app.post('/api/cashfree-webhook', async (req, res) => {
    try {
        const webhookData = req.body;
        console.log('Received Cashfree webhook:', JSON.stringify(webhookData));

        // Validate webhook signature for security
        const signature = req.headers['x-webhook-signature'] || '';

        // IMPORTANT: Always verify webhook signatures in production
        // Uncomment this in production
        const requestBody = JSON.stringify(req.body);
        const computedSignature = crypto
            .createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
            .update(requestBody)
            .digest('hex');

        if (signature !== computedSignature) {
            console.error('Invalid webhook signature');
            return res.status(401).json({ success: false, error: 'Invalid signature' });
        }


        // Process the webhook based on event type
        if (webhookData.data && webhookData.data.order) {
            const orderId = webhookData.data.order.order_id;
            const orderStatus = webhookData.data.order.order_status;

            console.log(`Processing webhook for order ${orderId} with status ${orderStatus}`);

            if (orderStatus === 'PAID') {
                // Find the reference ID associated with this order
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
                    userData.transactionId = webhookData.data.order.cf_order_id || webhookData.data.order.order_id;
                    registrations.set(referenceId, userData);
                    confirmedPayments.add(referenceId);

                    // Send confirmation emails
                    try {
                        await sendConfirmationEmails(
                            userData,
                            referenceId,
                            webhookData.data.order.cf_order_id || webhookData.data.order.order_id
                        );
                        console.log(`Confirmation emails sent for reference ID: ${referenceId}`);
                    } catch (emailError) {
                        console.error(`Failed to send confirmation emails for ${referenceId}:`, emailError);
                    }

                    console.log(`Payment confirmed for reference ID: ${referenceId}`);
                } else {
                    console.error(`Could not find referenceId for order ${orderId}`);
                }
            }
        }

        // Always return 200 to Cashfree
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Always return 200 to Cashfree even if there's an error on our side
        res.status(200).json({ success: true });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});