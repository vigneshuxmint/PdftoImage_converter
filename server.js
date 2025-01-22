const express = require('express');
const cors = require('cors'); // Import the cors middleware
const multer = require('multer');
const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg'); // PostgreSQL package
const https = require('https');
const options = {
    key: fs.readFileSync('./private.pem'), // Replace with the private key path
    cert: fs.readFileSync('./origin.pem'), // Replace with the certificate path
  };
  
const app = express();
require('dotenv').config();

// Enable CORS for all origins
app.use(cors());



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
    user: 'root',
    host: '165.232.185.65',
    database: 'n8n',
    password: 'password',
    port: 5432,
});



async function insertEvaluationLog() {
    const insertQuery = `
        INSERT INTO evaluations_log (status_log)
        VALUES ($1)
        RETURNING id, status_log;
    `;

    try {
        // Execute the query
        const result = await pool.query(insertQuery, ['pending']);
        
        // Log the inserted row
        console.log('Insert successful:', result.rows[0]);
    } catch (error) {
        console.error('Error inserting evaluation log:', error);
    } 
}

// Handle POST request to upload PDF file
app.post('/upload-pdf', upload.fields([
    { name: 'pdf', maxCount: 1 },
    { name: 'images', maxCount: 20 }, // Adjust maxCount as needed
]), async (req, res) => {
    const pdfFile = req.files?.pdf?.[0];
    const images = req.files?.images;
    const folderName = req.body.folderName || `folder-${Date.now()}`;

    if (!pdfFile || pdfFile.mimetype !== 'application/pdf') {
        return res.status(400).send('Invalid or missing PDF file.');
    }

    if (!images || images.length === 0) {
        return res.status(400).send('No images provided.');
    }

    try {
        // 1. Upload PDF file to DigitalOcean Spaces
        const pdfUniqueFileName = `${targetFolder}/pdf-${Date.now()}-${pdfFile.originalname}`;
        const pdfParams = {
            Bucket: bucketName,
            Key: pdfUniqueFileName,
            Body: pdfFile.buffer,
            ACL: 'public-read',
            ContentType: pdfFile.mimetype,
        };

        const pdfUploadResult = await s3.upload(pdfParams).promise();
        console.log(`Uploaded PDF: ${pdfUploadResult.Location}`);

      
        // 2. Process and upload images to DigitalOcean Spaces
        const uploadResults = [];
        for (const image of images) {
            const imageUniqueFileName = `${folderName}/image-${Date.now()}-${image.originalname}`;
            const imageParams = {
                Bucket: bucketName,
                Key: imageUniqueFileName,
                Body: image.buffer,
                ACL: 'public-read',
                ContentType: image.mimetype,
            };

            const imageUploadResult = await s3.upload(imageParams).promise();
            console.log(`Uploaded Image: ${imageUploadResult.Location}`);

            // Insert Image URL into PostgreSQL database with the same `pdflink`
            const imageInsertQuery = `
                INSERT INTO uploads (uploadid, activityid, fileurl, pdflink)
                VALUES (
                    (SELECT COALESCE(MAX(uploadid), 0) + 1 FROM uploads), 
                    102, 
                    $1,
                    $2
                )
            `;
            await pool.query(imageInsertQuery, [imageUploadResult.Location, pdfUploadResult.Location]);
            console.log(`Image link inserted into database: ${imageUploadResult.Location}`);
           



            uploadResults.push({
                fileName: image.originalname,
                fileUrl: imageUploadResult.Location,
            });
        }

        insertEvaluationLog();

        fetch('http://165.232.185.65:5678/webhook/54aad96e-008e-4f7b-a158-2e478f9d7350')
    .catch(error => console.error('Error triggering webhook:', error));

        // Response to client
        res.json({
            message: 'PDF and images uploaded successfully.',
            pdfUrl: pdfUploadResult.Location,
            images: uploadResults,
        });
    } catch (error) {
        console.error('Error uploading files:', error);
        res.status(500).send('Failed to upload files.');
    }
});



app.get('/students', async (req, res) => {
    try {
        const query = `
            SELECT *
            FROM students;
        `;

        const result = await pool.query(query);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No students found.' });
        }

        res.json({
            message: 'Students retrieved successfully.',
            students: result.rows, // Return rows as JSON
        });
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).send('Failed to fetch students.');
    }
});


app.get('/activity', async (req, res) => {
    try {
        const query = `
            SELECT *
            FROM activity_list;
        `;

        const result = await pool.query(query);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No activity found.' });
        }

        res.json({
            message: 'activity retrieved successfully.',
            students: result.rows, // Return rows as JSON
        });
    } catch (error) {
        console.error('Error fetching activity:', error);
        res.status(500).send('Failed to fetch activity.');
    }
});

app.get('/activity/:id', async (req, res) => {
    const activityId = req.params.id; // Extract activity_id from URL

    try {
        // Query the database for the specified activity_id
        const query = `
            SELECT * 
            FROM activity_list 
            WHERE activity_id = $1;
        `;
        const result = await pool.query(query, [activityId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Activity not found.' });
        }

        // Transform the result to match the desired JSON structure
        const activity = result.rows[0];

        const transformedActivity = {
            message: "activity retrieved successfully.",
            students: [
                {
                    activity_id: activity?.activity_id || "N/A",
                    title: activity?.title || "Untitled Activity",
                    age_group: activity?.age_group || "Not Specified",
                    description: activity?.description || "No description available.",
                    time_allocation: activity?.time_allocation || "Not Specified",
                    teaching_plan: Array.isArray(activity?.teaching_plan)
                        ? activity.teaching_plan.map((plan, index) => ({
                            step: index + 1,
                            title: `Step ${index + 1}`,
                            time: plan?.duration || "Not Specified",
                            content: plan?.content || "No content provided.",
                            goals: plan?.goal || "No goals specified.",
                            learnings: plan?.learnings || "No learnings specified.",
                        }))
                        : [], // Default to an empty array if teaching_plan is missing
                    evaluation_criteria: Array.isArray(activity?.evaluation_rubrics?.criteria)
                        ? activity.evaluation_rubrics.criteria.map((criterion) => ({
                            title: criterion?.name || "No title provided.",
                            levels: Array.isArray(criterion?.levels)
                                ? criterion.levels.map((level) => level?.description || "No description provided.")
                                : [], // Default to empty array for levels
                        }))
                        : [], // Default to empty array if evaluation_rubrics or criteria is missing
                    enrichment_opportunities: Array.isArray(activity?.additional_checks?.additional_checks)
                        ? activity.additional_checks.additional_checks.map((check) => ({
                            title: check?.name || "Untitled",
                            content: check?.description || "No content provided.",
                        }))
                        : [], // Default to an empty array if additional_checks is missing
                },
            ],
        };
        

        res.json(transformedActivity);
    } catch (error) {
        console.error('Error fetching activity:', error);
        res.status(500).json({ message: 'Failed to fetch activity.' });
    }
});



app.get('/evaluations/:student_id', async (req, res) => {
    const { student_id } = req.params;

    try {
        const query = `
            SELECT *
            FROM evaluations
            WHERE student_id = $1;
        `;

        const result = await pool.query(query, [student_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No evaluations found for this student ID.' });
        }

        res.json({
            message: 'Evaluations retrieved successfully.',
            evaluations: result.rows, // Return rows as JSON
        });
    } catch (error) {
        console.error('Error fetching evaluations:', error);
        res.status(500).send('Failed to fetch evaluations.');
    }
});


app.get('/sub', async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT student_id
            FROM evaluations;
        `;

        const result = await pool.query(query);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No students found in the evaluations table.' });
        }

        res.json({
            message: 'Student IDs retrieved successfully.',
            sub: result.rows.map(row => row.student_id), // Extract just the student_id values
        });
    } catch (error) {
        console.error('Error fetching student IDs:', error);
        res.status(500).send('Failed to fetch student IDs.');
    }
});


app.get('/last-status', async (req, res) => {
    try {
        // Query to fetch the last row based on the id column
        const query = `
            SELECT status_log 
            FROM evaluations_log 
            ORDER BY id DESC 
            LIMIT 1;
        `;

        const result = await pool.query(query);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No records found in evaluations_log.' });
        }

        // Extract the status_log from the last row
        const statusLog = result.rows[0].status_log;

        res.json({
            message: 'Last status retrieved successfully.',
            status_log: statusLog,
        });
    } catch (error) {
        console.error('Error fetching last status:', error);
        res.status(500).json({ message: 'Failed to fetch last status.' });
    }
});

// Start server
https.createServer(options, app).listen(443, () => {
    console.log('HTTPS server running on port 443');
  });