// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const axios = require('axios');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// You'll need to create a service account key in Firebase console and save it
let serviceAccount;
try {
    // Try to load service account from environment variables (for production)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        // Fallback to local file for development
        serviceAccount = require('./firebase-service-account.json');
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (error) {
    console.error('Firebase admin initialization error:', error);
    // Continue without Firebase Admin if not configured
}

const app = express();
const PORT = process.env.PORT || 5000;
const db = admin.firestore ? admin.firestore() : null;

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

// Firebase Auth Middleware
const verifyFirebaseToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ') || !admin.auth) {
        // Skip verification if no token or Firebase Admin not initialized
        return next();
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Error verifying Firebase token:', error);
        // Continue without user verification
        next();
    }
};

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

// Function to save registration to Firestore
async function saveRegistrationToFirestore(userId, registrationData) {
    if (!db) return false;

    try {
        // If userId provided, save to user's document
        if (userId) {
            const userRef = db.collection('users').doc(userId);
            const userDoc = await userRef.get();

            if (userDoc.exists) {
                const userData = userDoc.data();
                const registrations = userData.registrations || [];

                // Add new registration
                registrations.push({
                    ...registrationData,
                    timestamp: new Date().toISOString()
                });

                // Update user document
                await userRef.update({ registrations });
            }
        }

        // Save to registrations collection regardless of user
        await db.collection('registrations').doc(registrationData.referenceId).set({
            ...registrationData,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return true;
    } catch (error) {
        console.error('Firestore save error:', error);
        return false;
    }
}

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

// API Routes - Apply Firebase verification where needed
app.post('/api/register', verifyFirebaseToken, async (req, res) => {
    try {
        const { fullName, email, phone } = req.body;

        if (!fullName || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const referenceId = crypto.randomBytes(6).toString('hex');
        const timestamp = Date.now();

        // Save in local memory
        registrations.set(referenceId, {
            fullName,
            email,
            phone,
            timestamp,
            paymentConfirmed: false,
            userId: req.user?.uid || null
        });

        // Save in Firestore if available
        if (db) {
            try {
                await saveRegistrationToFirestore(req.user?.uid, {
                    referenceId,
                    fullName,
                    email,
                    phone,
                    timestamp,
                    paymentConfirmed: false
                });
            } catch (firestoreError) {
                console.error('Firestore save error:', firestoreError);
                // Continue with local storage even if Firestore fails
            }
        }

        res.json({
            success: true,
            referenceId: referenceId
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

app.post('/api/create-payment-order', verifyFirebaseToken, async (req, res) => {
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
            amount: 100, // amount in paisa (99 INR)
            currency: "INR",
            receipt: `receipt_${referenceId}`,
            notes: {
                referenceId: referenceId,
                customerName: userData.fullName,
                customerEmail: userData.email,
                customerPhone: userData.phone,
                userId: req.user?.uid || userData.userId || null
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

app.get('/api/check-payment', verifyFirebaseToken, (req, res) => {
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
            // Try to check in Firestore if available
            if (db) {
                db.collection('registrations').doc(referenceId).get()
                    .then(doc => {
                        if (doc.exists && doc.data().paymentConfirmed) {
                            res.json({ success: true });
                        } else {
                            res.json({
                                success: false,
                                status: 'UNKNOWN',
                                message: 'Invalid reference ID or payment not confirmed'
                            });
                        }
                    })
                    .catch(err => {
                        console.error('Firestore fetch error:', err);
                        res.json({
                            success: false,
                            status: 'UNKNOWN',
                            message: 'Invalid reference ID'
                        });
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
        console.error('Check payment error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error while checking payment'
        });
    }
});

app.post('/api/confirm-payment', verifyFirebaseToken, async (req, res) => {
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

        let userData;
        if (registrations.has(referenceId)) {
            userData = registrations.get(referenceId);
        } else if (db) {
            // Try to fetch from Firestore
            const doc = await db.collection('registrations').doc(referenceId).get();
            if (doc.exists) {
                userData = doc.data();
            } else {
                return res.status(404).json({
                    error: 'Invalid reference ID'
                });
            }
        } else {
            return res.status(404).json({
                error: 'Invalid reference ID'
            });
        }

        // Update payment information
        userData.paymentConfirmed = true;
        userData.transactionId = razorpay_payment_id;

        if (registrations.has(referenceId)) {
            registrations.set(referenceId, userData);
        }
        confirmedPayments.add(referenceId);

        // Update in Firestore if available
        if (db) {
            try {
                await db.collection('registrations').doc(referenceId).update({
                    paymentConfirmed: true,
                    transactionId: razorpay_payment_id,
                    paymentDate: admin.firestore.FieldValue.serverTimestamp()
                });

                // Update in user's document if userId available
                const userId = userData.userId || req.user?.uid;
                if (userId) {
                    const userRef = db.collection('users').doc(userId);
                    const userDoc = await userRef.get();

                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        const registrations = userData.registrations || [];

                        // Find and update the registration
                        const registrationIndex = registrations.findIndex(r => r.referenceId === referenceId);
                        if (registrationIndex !== -1) {
                            registrations[registrationIndex].paymentConfirmed = true;
                            registrations[registrationIndex].transactionId = razorpay_payment_id;

                            await userRef.update({ registrations });
                        }
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore update error:', firestoreError);
                // Continue even if Firestore update fails
            }
        }

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

app.post('/api/inspiringshereen-webhook', async (req, res) => {
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
            let userData = null;

            // Check local memory
            for (const [key, value] of registrations.entries()) {
                if (value.orderId === orderId) {
                    referenceId = key;
                    userData = value;
                    break;
                }
            }

            // If not found in memory, check Firestore
            if (!referenceId && db) {
                try {
                    const registrationsSnapshot = await db.collection('registrations')
                        .where('orderId', '==', orderId)
                        .limit(1)
                        .get();

                    if (!registrationsSnapshot.empty) {
                        const doc = registrationsSnapshot.docs[0];
                        referenceId = doc.id;
                        userData = doc.data();
                    }
                } catch (firestoreError) {
                    console.error('Firestore query error:', firestoreError);
                }
            }

            if (referenceId && userData) {
                // Update in memory if available
                if (registrations.has(referenceId)) {
                    userData.paymentConfirmed = true;
                    userData.transactionId = paymentId;
                    registrations.set(referenceId, userData);
                }
                confirmedPayments.add(referenceId);

                // Update in Firestore if available
                if (db) {
                    try {
                        await db.collection('registrations').doc(referenceId).update({
                            paymentConfirmed: true,
                            transactionId: paymentId,
                            paymentDate: admin.firestore.FieldValue.serverTimestamp()
                        });

                        // Update in user's document if userId available
                        const userId = userData.userId;
                        if (userId) {
                            const userRef = db.collection('users').doc(userId);
                            const userDoc = await userRef.get();

                            if (userDoc.exists) {
                                const userData = userDoc.data();
                                const registrations = userData.registrations || [];

                                // Find and update the registration
                                const registrationIndex = registrations.findIndex(r => r.referenceId === referenceId);
                                if (registrationIndex !== -1) {
                                    registrations[registrationIndex].paymentConfirmed = true;
                                    registrations[registrationIndex].transactionId = paymentId;

                                    await userRef.update({ registrations });
                                }
                            }
                        }
                    } catch (firestoreError) {
                        console.error('Firestore update error:', firestoreError);
                    }
                }

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

// Admin routes - secured with Firebase Auth
app.get('/api/admin/registrations', verifyFirebaseToken, async (req, res) => {
    // Check if user is authenticated and has admin role
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        let registrationsData = [];

        // If Firestore is available, get data from there
        if (db) {
            const snapshot = await db.collection('registrations').orderBy('createdAt', 'desc').get();
            registrationsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate() || null
            }));
        } else {
            // Otherwise use in-memory data
            registrationsData = Array.from(registrations.entries()).map(([key, value]) => ({
                id: key,
                ...value
            }));
        }

        res.json({
            success: true,
            registrations: registrationsData
        });
    } catch (error) {
        console.error('Admin registrations fetch error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

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