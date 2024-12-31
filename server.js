const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');

const app = express();
require('dotenv').config();

// Multer setup for file uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// DigitalOcean Spaces Config
const spacesEndpoint = new AWS.Endpoint('sgp1.digitaloceanspaces.com');  // SGP1 region
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.DO_ACCESS_KEY,  // Store keys as environment variables
    secretAccessKey: process.env.DO_SECRET_KEY,  // Store keys securely
});

// Space and folder setup
const bucketName = 'uxmintassets';  // Space name
const targetFolder = 'pdf2jpeg';    // Folder inside the Space

// Handle POST request to upload files
app.post('/upload-folder', upload.array('images'), async (req, res) => {
    const files = req.files;

    if (!files || files.length === 0) {
        return res.status(400).send('No images provided.');
    }

    try {
        // Upload each file to the Space under the pdf2jpeg folder
        for (const file of files) {
            const filePath = `${targetFolder}/${file.originalname}`;
            const params = {
                Bucket: bucketName,
                Key: filePath,
                Body: file.buffer,
                ACL: 'public-read',  // Optional: Make public
                ContentType: file.mimetype,
            };

            const uploadResult = await s3.upload(params).promise();
            console.log(`Uploaded: ${uploadResult.Location}`);
        }

        res.json({ message: `Files uploaded successfully to '${targetFolder}'.` });
    } catch (error) {
        console.error('Error uploading files:', error);
        res.status(500).send('Failed to upload files.');
    }
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
