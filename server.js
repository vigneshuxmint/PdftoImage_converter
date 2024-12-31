const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.post('/upload-folder', upload.array('images'), (req, res) => {
  const folderName = req.body.folderName;
  const files = req.files;

  if (!folderName || !files || files.length === 0) {
    return res.status(400).send('No folder name or images provided.');
  }

  const saveDir = path.join(__dirname, 'uploaded_folders', folderName);
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true });
    console.log(`Created folder: ${saveDir}`);
  }

  files.forEach((file) => {
    const filePath = path.join(saveDir, file.originalname);
    fs.writeFileSync(filePath, file.buffer);
    console.log(`Saved file: ${filePath}`);
  });

  res.json({ message: `Folder '${folderName}' uploaded successfully.` });
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
