require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const axios = require('axios');
const admin = require('firebase-admin');
const Razorpay = require('razorpay'); // Make sure this is installed

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Initialize Firebase Admin SDK
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
} else {
    console.error('Firebase service account not found in environment variables');
    process.exit(1);
}

// Get a database reference
const db = admin.database();
const registrationsRef = db.ref('registrations');
const confirmedPaymentsRef = db.ref('confirmedPayments');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    // origin: ["http://localhost:3000", "http://localhost:5173"],
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

// Use regular bodyParser for all routes except webhook
app.use((req, res, next) => {
    if (req.originalUrl === '/api/inspiringshereen-webhook') {
        // Raw body needed for webhook signature verification
        bodyParser.raw({ type: 'application/json' })(req, res, next);
    } else {
        bodyParser.json()(req, res, next);
    }
});

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

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
        console.error('Error sending confirmation emails:', emailError);
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

// Firebase Auth Middleware
const authenticateFirebase = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized: No valid authentication token provided' });
        }

        const token = authHeader.split('Bearer ')[1];

        // Verify the Firebase ID token
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// Admin auth middleware
const verifyAdmin = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized: Authentication required' });
    }

    try {
        // Get user custom claims to check admin status
        const userRecord = await admin.auth().getUser(req.user.uid);
        const customClaims = userRecord.customClaims || {};

        if (!customClaims.admin) {
            return res.status(403).json({ error: 'Forbidden: Admin access required' });
        }

        next();
    } catch (error) {
        console.error('Admin verification error:', error);
        return res.status(500).json({ error: 'Error verifying admin status' });
    }
};

// Update user registration
app.post('/api/user/registrations', authenticateFirebase, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { referenceId, ...registrationData } = req.body;

        if (!referenceId) {
            return res.status(400).json({
                success: false,
                error: 'Reference ID is required'
            });
        }

        // Update user registration in RTDB
        await db.ref(`users/${uid}/registrations/${referenceId}`).set({
            ...registrationData,
            timestamp: registrationData.timestamp || new Date().toISOString()
        });

        // Store in global registrations as well
        await registrationsRef.child(referenceId).set({
            ...registrationData,
            uid,
            timestamp: registrationData.timestamp || new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Registration updated successfully'
        });
    } catch (error) {
        console.error('Error updating registration:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update registration'
        });
    }
});

// In server.js - Update the /api/create-payment-order route handler
app.post('/api/create-payment-order', authenticateFirebase, async (req, res) => {
    try {
        // Add detailed logging
        console.log('Creating payment order. Request body:', req.body);
        console.log('Authenticated user:', req.user ? req.user.uid : 'No user');

        // Check both request body and query parameters for referenceId
        const referenceId = req.body.referenceId || req.query.referenceId;

        if (!referenceId) {
            console.error('Missing referenceId in request');
            return res.status(400).json({
                success: false,
                error: 'Reference ID is required'
            });
        }

        console.log(`Using referenceId: ${referenceId}`);

        // Verify the registration exists in Firebase
        const regSnapshot = await registrationsRef.child(referenceId).once('value');
        if (!regSnapshot.exists()) {
            console.error(`Registration with ID ${referenceId} not found in Firebase`);
            return res.status(404).json({
                success: false,
                error: 'Registration not found'
            });
        }

        // Rest of your existing code...
        const amount = 9900;
        console.log(`Creating Razorpay order with amount: ${amount}`);

        const options = {
            amount,
            currency: "INR",
            receipt: referenceId,
            payment_capture: 1
        };

        console.log('Razorpay options:', options);

        // Include proper error handling when calling Razorpay
        try {
            const order = await razorpay.orders.create(options);
            console.log('Razorpay order created successfully:', order.id);

            // Store order ID in registration
            await registrationsRef.child(referenceId).update({
                orderId: order.id,
                orderAmount: amount / 100,
                orderCurrency: "INR",
                orderStatus: "created",
                orderTimestamp: new Date().toISOString()
            });

            res.status(200).json({
                success: true,
                orderId: order.id,
                razorpayKey: RAZORPAY_KEY_ID
            });
        } catch (razorpayError) {
            console.error('🔴 Razorpay API Error:', {
                message: razorpayError.message,
                error: razorpayError.error,
                statusCode: razorpayError.statusCode,
                stack: razorpayError.stack
            });

            res.status(500).json({
                success: false,
                error: razorpayError?.error?.description || razorpayError.message || "Unknown Razorpay error",
                code: razorpayError?.error?.code || 'unknown'
            });
        }
    } catch (err) {
        console.error('General error creating payment order:', err);
        res.status(500).json({
            success: false,
            error: err.message || "Payment order creation failed"
        });
    }
});

app.get('/api/check-payment', authenticateFirebase, async (req, res) => {
    try {
        const referenceId = req.query.reference_id;

        if (!referenceId) {
            return res.status(400).json({
                success: false,
                error: 'Reference ID is required'
            });
        }

        // Check if payment is confirmed in Firebase
        const confirmedSnapshot = await confirmedPaymentsRef.child(referenceId).once('value');
        const isConfirmed = confirmedSnapshot.exists();

        if (isConfirmed) {
            res.json({ success: true });
        } else {
            // Check if registration exists
            const registrationSnapshot = await registrationsRef.child(referenceId).once('value');

            if (registrationSnapshot.exists()) {
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
        }
    } catch (error) {
        console.error('Error checking payment:', error);
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
                success: false,
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
                success: false,
                error: 'Invalid payment signature'
            });
        }

        // Get user data from Firebase
        const userDataSnapshot = await registrationsRef.child(referenceId).once('value');
        const userData = userDataSnapshot.val();

        if (!userData) {
            return res.status(404).json({
                success: false,
                error: 'Invalid reference ID'
            });
        }

        // Update payment information in Firebase
        await registrationsRef.child(referenceId).update({
            paymentConfirmed: true,
            transactionId: razorpay_payment_id,
            paymentStatus: 'Confirmed',
            paymentTimestamp: new Date().toISOString()
        });

        // Add to confirmed payments
        await confirmedPaymentsRef.child(referenceId).set({
            paymentId: razorpay_payment_id,
            orderId: razorpay_order_id,
            timestamp: new Date().toISOString()
        });

        // Send confirmation emails
        await sendConfirmationEmails(userData, referenceId, razorpay_payment_id);

        res.json({
            success: true,
            referenceId
        });
    } catch (error) {
        console.error('Error confirming payment:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Something went wrong during payment confirmation'
        });
    }
});

// Webhook route with raw body parser for signature verification
app.post('/api/inspiringshereen-webhook', async (req, res) => {
    try {
        // For raw body parser, we need to parse the buffer to JSON
        const webhook_body = req.body.toString();
        const webhookData = JSON.parse(webhook_body);
        console.log('Webhook received:', webhookData.event);

        // Verify webhook signature
        const webhookSignature = req.headers['x-razorpay-signature'];

        if (webhookSignature) {
            const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

            if (webhookSecret) {
                const generatedSignature = crypto
                    .createHmac('sha256', webhookSecret)
                    .update(webhook_body)
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

            // Find registration by order ID in Firebase
            const registrationsSnapshot = await registrationsRef.orderByChild('orderId').equalTo(orderId).once('value');
            const registrations = registrationsSnapshot.val();

            if (registrations) {
                // There should be only one registration with this order ID
                const referenceId = Object.keys(registrations)[0];
                const userData = registrations[referenceId];

                if (referenceId && userData) {
                    // Update in Firebase
                    await registrationsRef.child(referenceId).update({
                        paymentConfirmed: true,
                        transactionId: paymentId,
                        paymentStatus: 'Confirmed',
                        paymentTimestamp: new Date().toISOString()
                    });

                    // Add to confirmed payments
                    await confirmedPaymentsRef.child(referenceId).set({
                        paymentId,
                        orderId,
                        timestamp: new Date().toISOString()
                    });

                    // If user ID is available, update user registration too
                    if (userData.uid) {
                        await db.ref(`users/${userData.uid}/registrations/${referenceId}`).update({
                            paymentConfirmed: true,
                            transactionId: paymentId,
                            paymentStatus: 'Confirmed',
                            paymentTimestamp: new Date().toISOString()
                        });
                    }

                    // Send confirmation emails ONLY for successful payments
                    try {
                        await sendConfirmationEmails(userData, referenceId, paymentId);
                        console.log('Webhook: confirmation emails sent for payment', paymentId);
                    } catch (emailError) {
                        console.error('Webhook: failed to send confirmation emails:', emailError);
                    }
                }
            } else {
                console.warn('Webhook: registration not found for order', orderId);
            }
        } else if (webhookData.event === 'payment.failed') {
            console.log('Payment failed webhook received');

            // Update payment status in registration
            const paymentData = webhookData.payload.payment.entity;
            const orderId = paymentData.order_id;

            // Find registration by order ID
            const registrationsSnapshot = await registrationsRef.orderByChild('orderId').equalTo(orderId).once('value');
            const registrations = registrationsSnapshot.val();

            if (registrations) {
                const referenceId = Object.keys(registrations)[0];

                // Update status to failed
                await registrationsRef.child(referenceId).update({
                    paymentStatus: 'Failed',
                    failureReason: paymentData.error_description || 'Payment failed',
                    failureTimestamp: new Date().toISOString()
                });
            }
        }

        // Always return 200 for webhooks to acknowledge receipt
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Always return 200 for webhooks to prevent retries
        res.status(200).json({ success: true });
    }
});

// Admin routes - secured with Firebase Auth and Admin Check
app.get('/api/admin/registrations', authenticateFirebase, verifyAdmin, async (req, res) => {
    try {
        // Get all registrations from Firebase
        const registrationsSnapshot = await registrationsRef.once('value');
        const registrationsData = registrationsSnapshot.val() || {};

        // Convert to array format
        const formattedRegistrations = Object.entries(registrationsData).map(([key, value]) => ({
            id: key,
            ...value
        }));

        res.json({
            success: true,
            registrations: formattedRegistrations
        });
    } catch (error) {
        console.error('Error fetching registrations:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// Add these routes to your server.js file

// Update in server.js
app.get('/api/admin/users', authenticateFirebase, verifyAdmin, async (req, res) => {
    try {
        // List all users from Firebase Auth
        const listUsersResult = await admin.auth().listUsers();
        const users = [];

        // Get additional data from RTDB for each user
        for (const userRecord of listUsersResult.users) {
            try {
                // Get user data from RTDB
                const userRef = db.ref(`users/${userRecord.uid}`);
                const snapshot = await userRef.once('value');
                const userData = snapshot.val() || {};

                if (!snapshot.exists()) {
                    console.log(`Creating missing RTDB data for user ${userRecord.uid}, using Auth data only`);

                    // If RTDB data doesn't exist, create it now from Auth data
                    await userRef.set({
                        fullName: userRecord.displayName || '',
                        email: userRecord.email,
                        createdAt: userRecord.metadata.creationTime
                    });
                }

                // Merge Auth and RTDB data
                users.push({
                    id: userRecord.uid,
                    email: userRecord.email,
                    fullName: userRecord.displayName || userData.fullName || '',
                    phone: userData.phone || '',
                    disabled: userRecord.disabled || false,
                    emailVerified: userRecord.emailVerified,
                    createdAt: userData.createdAt || userRecord.metadata.creationTime,
                    lastSignInTime: userRecord.metadata.lastSignInTime,
                    registrations: userData.registrations || []
                });
            } catch (userError) {
                console.error(`Error fetching data for user ${userRecord.uid}:`, userError);
                // Still include basic user info even if RTDB data fetch fails
                users.push({
                    id: userRecord.uid,
                    email: userRecord.email,
                    fullName: userRecord.displayName || '',
                    disabled: userRecord.disabled || false,
                    emailVerified: userRecord.emailVerified,
                    createdAt: userRecord.metadata.creationTime,
                    lastSignInTime: userRecord.metadata.lastSignInTime,
                });
            }
        }

        res.json({
            success: true,
            users
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch users'
        });
    }
});

// Toggle user status (enable/disable)
app.put('/api/admin/users/:userId/toggle-status', authenticateFirebase, verifyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { disabled } = req.body;

        if (typeof disabled !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'Disabled status must be a boolean'
            });
        }

        // Update user in Firebase Auth
        await admin.auth().updateUser(userId, { disabled });

        res.json({
            success: true,
            message: `User ${disabled ? 'disabled' : 'enabled'} successfully`
        });
    } catch (error) {
        console.error('Error toggling user status:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to update user status'
        });
    }
});

// Delete user account
app.delete('/api/admin/users/:userId', authenticateFirebase, verifyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        // Delete user from Firebase Auth
        await admin.auth().deleteUser(userId);

        // Delete user data from RTDB
        await db.ref(`users/${userId}`).remove();

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to delete user'
        });
    }
});

// Route to create new user (admin only)
app.post('/api/admin/users', authenticateFirebase, verifyAdmin, async (req, res) => {
    try {
        const { email, password, fullName, phone, isAdmin } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Create new user in Firebase Auth
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: fullName,
            disabled: false
        });

        // Set admin claim if needed
        if (isAdmin) {
            await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });
        }

        // Save additional user data to RTDB
        await db.ref(`users/${userRecord.uid}`).set({
            fullName: fullName || '',
            email,
            phone: phone || '',
            createdAt: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'User created successfully',
            userId: userRecord.uid
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create user'
        });
    }
});

// Route to set initial admin user
app.post('/api/setup-admin', async (req, res) => {
    // This endpoint should typically be secured or disabled in production
    // It's used for initial setup only
    try {
        const { adminEmail, password, setupToken } = req.body;

        // Basic security check to prevent unauthorized setup
        // In a real app, use a more secure mechanism
        if (!setupToken || setupToken !== 'initial-setup-token') {
            return res.status(403).json({ error: 'Unauthorized setup attempt' });
        }

        // Look for the user by email
        try {
            const userRecord = await admin.auth().getUserByEmail(adminEmail);
            // If user exists, set admin claim
            await admin.auth().setCustomUserClaims(userRecord.uid, { admin: true });

            return res.json({
                success: true,
                message: 'Admin privileges granted to existing user',
                uid: userRecord.uid
            });
        } catch (userError) {
            // User doesn't exist, create new admin user
            if (userError.code === 'auth/user-not-found') {
                const newUserRecord = await admin.auth().createUser({
                    email: adminEmail,
                    password: password,
                    emailVerified: true
                });

                await admin.auth().setCustomUserClaims(newUserRecord.uid, { admin: true });

                return res.json({
                    success: true,
                    message: 'New admin user created',
                    uid: newUserRecord.uid
                });
            }

            throw userError;
        }
    } catch (error) {
        console.error('Error setting up admin:', error);
        res.status(500).json({ error: error.message || 'Failed to setup admin user' });
    }
});

// Enhanced error logging route
app.post('/api/log-error', (req, res) => {
    try {
        const { message, stack, user, context } = req.body;

        console.error('🚨 Client-side error:', {
            timestamp: new Date().toISOString(),
            message,
            stack,
            user: user ? `${user.email} (${user.id})` : 'Unknown',
            context
        });

        res.status(200).json({ logged: true });
    } catch (error) {
        console.error('Error logging client error:', error);
        res.status(500).json({ logged: false });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    const healthStatus = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            email: !!process.env.EMAIL_USER && !!process.env.EMAIL_PASSWORD ? 'configured' : 'unconfigured',
            razorpay: !!RAZORPAY_KEY_ID && !!RAZORPAY_KEY_SECRET ? 'configured' : 'unconfigured',
            firebase: admin.apps.length > 0 ? 'connected' : 'disconnected'
        }
    };

    res.json(healthStatus);
});

// Start server with improved logging
app.listen(PORT, () => {
    console.log(`
    ✅ ====================================== ✅
    🚀 Server running on port ${PORT}
    📅 ${new Date().toISOString()}
    📧 Email Service: ${process.env.EMAIL_USER ? 'Configured ✓' : 'Missing ✗'}
    💰 Razorpay: ${RAZORPAY_KEY_ID ? 'Configured ✓' : 'Missing ✗'}
    🔥 Firebase: ${admin.apps.length > 0 ? 'Connected ✓' : 'Missing ✗'}
    ✅ ====================================== ✅
    `);
});