const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg'); // PostgreSQL package

const app = express();
require('dotenv').config();

// Multer setup for file uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// DigitalOcean Spaces Config
const spacesEndpoint = new AWS.Endpoint('sgp1.digitaloceanspaces.com'); // SGP1 region
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.DO_ACCESS_KEY, // Store keys as environment variables
    secretAccessKey: process.env.DO_SECRET_KEY, // Store keys securely
});

// Space and folder setup
const bucketName = 'uxmintassets'; // Space name
const targetFolder = 'pdf-uploads'; // Folder for PDFs

// PostgreSQL Database Config
const pool = new Pool({
    user: 'admin',
    host: '68.183.88.156',
    database: 'octa',
    password: 'admin',
    port: 5432,
});

// Handle POST request to upload PDF file
app.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
    const file = req.file;

    if (!file || file.mimetype !== 'application/pdf') {
        return res.status(400).send('Invalid file. Please upload a PDF.');
    }

    try {
        // Generate unique filename and upload to DigitalOcean Spaces
        const uniqueFileName = `${targetFolder}/pdf-${Date.now()}-${file.originalname}`;
        const params = {
            Bucket: bucketName,
            Key: uniqueFileName,
            Body: file.buffer,
            ACL: 'public-read', // Optional: Make public
            ContentType: file.mimetype,
        };

        const uploadResult = await s3.upload(params).promise();
        console.log(`Uploaded: ${uploadResult.Location}`);

        // Insert into PostgreSQL database
        const query = `
            INSERT INTO uploads (uploadid, activityid, fileurl)
            VALUES (
                (SELECT COALESCE(MAX(uploadid), 0) + 1 FROM uploads), 
                101, 
                $1
            )
        `;
        const values = [uploadResult.Location];

        await pool.query(query, values);
        console.log('PDF link inserted into database.');

        res.json({
            message: 'PDF uploaded successfully.',
            fileUrl: uploadResult.Location,
        });
    } catch (error) {
        console.error('Error uploading PDF:', error);
        res.status(500).send('Failed to upload PDF.');
    }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
