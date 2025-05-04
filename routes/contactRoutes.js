// routes/contactRoutes.js
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Create email transporter using environment variables
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // inspiringshereen@gmail.com
        pass: process.env.EMAIL_PASSWORD // from your .env file
    }
});

// Contact form submission endpoint
router.post('/contact', async (req, res) => {
    try {
        const { name, email, phone, courseInterest, message } = req.body;

        // Validate required fields
        // Change this validation
        if (!name || !email || !message) {  // Removed !courseInterest
            return res.status(400).json({
                success: false,
                error: 'Please provide all required fields'
            });
        }

        // Format course interest for email
        let courseInterestText = '';
        switch (courseInterest) {
            case 'beginner':
                courseInterestText = 'Beginner Phonics';
                break;
            case 'advanced':
                courseInterestText = 'Advanced Pronunciation';
                break;
            case 'professional':
                courseInterestText = 'Professional Speaking';
                break;
            case 'custom':
                courseInterestText = 'Custom Learning Plan';
                break;
            default:
                courseInterestText = courseInterest;
        }

        // Email to site owner
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to yourself
            subject: 'New Phonics Program Inquiry',
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 5px;">
          <h2 style="color: #4F46E5; margin-top: 0;">New Inquiry from Website</h2>
          
          <div style="margin-bottom: 20px; padding: 15px; background-color: #f9fafb; border-radius: 5px;">
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
            <p><strong>Program Interest:</strong> ${courseInterestText}</p>
          </div>
          
          <div style="background-color: #f0f9ff; padding: 15px; border-radius: 5px;">
            <h3 style="color: #0369a1; margin-top: 0;">Message:</h3>
            <p style="white-space: pre-line;">${message}</p>
          </div>
          
          <p style="margin-top: 20px; font-size: 14px; color: #6b7280;">This inquiry was submitted from your website's contact form.</p>
        </div>
      `
        };

        // Email confirmation to the user
        const userMailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Thank you for your inquiry - Phonics Program',
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 5px;">
          <h2 style="color: #4F46E5; margin-top: 0;">Thank You for Your Interest!</h2>
          
          <p>Dear ${name},</p>
          
          <p>Thank you for inquiring about our ${courseInterestText} program. We've received your message and will get back to you shortly.</p>
          
          <div style="background-color: #f0f9ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #0369a1; margin-top: 0;">Your Message:</h3>
            <p style="white-space: pre-line;">${message}</p>
          </div>
          
          <p>If you have any urgent questions, please feel free to reach out directly to <a href="mailto:inspiringshereen@gmail.com">inspiringshereen@gmail.com</a>.</p>
          
          <p style="margin-top: 20px;">Warm regards,</p>
          <p><strong>Mrs. Shereen</strong><br>
          Phonics Teaching Specialist</p>
        </div>
      `
        };

        // Send emails
        await transporter.sendMail(mailOptions);
        await transporter.sendMail(userMailOptions);

        res.status(200).json({
            success: true,
            message: 'Your message has been sent successfully'
        });

    } catch (error) {
        console.error('Contact form submission error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send your message. Please try again later.'
        });
    }
});

module.exports = router;