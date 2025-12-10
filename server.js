require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Create ar-sessions directory and file if it doesn't exist
const arSessionsDir = path.join(__dirname, 'ar-sessions');
const arSessionsFile = path.join(arSessionsDir, 'sessions.json');
if (!fs.existsSync(arSessionsDir)) {
  fs.mkdirSync(arSessionsDir, { recursive: true });
}
if (!fs.existsSync(arSessionsFile)) {
  fs.writeFileSync(arSessionsFile, JSON.stringify({ sessions: [] }, null, 2));
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (jpeg, jpg, png, webp) are allowed'));
    }
  }
});

// In-memory storage for loved ones profiles (upgrade to database later)
let lovedOnes = {};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Memory Generator API is running' });
});

// Create a loved one profile (Grief Support Feature)
app.post('/api/loved-ones', upload.array('photos', 10), (req, res) => {
  try {
    const { name, description, relationship } = req.body;
    
    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one photo is required' });
    }
    
    const lovedOneId = Date.now().toString();
    const photos = req.files.map(file => `/uploads/${file.filename}`);
    
    lovedOnes[lovedOneId] = {
      id: lovedOneId,
      name,
      description,
      relationship: relationship || '',
      photos,
      createdAt: new Date().toISOString()
    };
    
    console.log(`Created loved one profile: ${name} (${lovedOneId})`);
    
    res.json({
      success: true,
      lovedOne: lovedOnes[lovedOneId]
    });
    
  } catch (error) {
    console.error('Error creating loved one profile:', error);
    res.status(500).json({ error: 'Failed to create loved one profile: ' + error.message });
  }
});

// Get all loved ones
app.get('/api/loved-ones', (req, res) => {
  res.json({
    success: true,
    lovedOnes: Object.values(lovedOnes)
  });
});

// Get specific loved one
app.get('/api/loved-ones/:id', (req, res) => {
  const lovedOne = lovedOnes[req.params.id];
  
  if (!lovedOne) {
    return res.status(404).json({ error: 'Loved one not found' });
  }
  
  res.json({
    success: true,
    lovedOne
  });
});

// Delete a loved one profile
app.delete('/api/loved-ones/:id', (req, res) => {
  const lovedOne = lovedOnes[req.params.id];
  
  if (!lovedOne) {
    return res.status(404).json({ error: 'Loved one not found' });
  }
  
  // Delete uploaded photos
  lovedOne.photos.forEach(photoPath => {
    const fullPath = path.join(__dirname, photoPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  });
  
  delete lovedOnes[req.params.id];
  
  res.json({
    success: true,
    message: 'Loved one profile deleted'
  });
});

// Generate memory with loved one (Grief Support Feature)
app.post('/api/generate-with-loved-one', async (req, res) => {
  try {
    const { prompt, lovedOneId } = req.body;
    
    if (!prompt || !lovedOneId) {
      return res.status(400).json({ error: 'Prompt and lovedOneId are required' });
    }
    
    const lovedOne = lovedOnes[lovedOneId];
    
    if (!lovedOne) {
      return res.status(404).json({ error: 'Loved one not found' });
    }
    
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured on server' 
      });
    }
    
    // Enhance prompt with loved one's description
    const enhancedPrompt = `${prompt}. The scene includes ${lovedOne.name}, ${lovedOne.description}. ${lovedOne.relationship ? `They were my ${lovedOne.relationship}.` : ''} Create this as a vintage dreamlike polaroid photograph with surreal, ethereal qualities, soft focus, nostalgic muted tones, and a touch of the uncanny.`;
    
    console.log('Generating memory with loved one:', lovedOne.name);
    console.log('Enhanced prompt:', enhancedPrompt);
    
    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: enhancedPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard'
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('OpenAI API error:', data);
      return res.status(response.status).json({ 
        error: data.error?.message || 'Failed to generate image' 
      });
    }
    
    res.json({
      success: true,
      imageUrl: data.data[0].url,
      revisedPrompt: data.data[0].revised_prompt,
      lovedOneName: lovedOne.name
    });
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error: ' + error.message 
    });
  }
});

// Image generation endpoint (original feature)
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Check if API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured on server. Please set OPENAI_API_KEY environment variable.' 
      });
    }

    // Add the vintage dreamlike polaroid aesthetic
    const styledPrompt = prompt + ', as a vintage dreamlike polaroid photograph with surreal, ethereal qualities, soft focus, nostalgic muted tones, and a touch of the uncanny';

    console.log('Generating image for prompt:', styledPrompt);

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: styledPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard'
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI API error:', data);
      return res.status(response.status).json({ 
        error: data.error?.message || 'Failed to generate image' 
      });
    }

    // Return the image URL
    res.json({
      success: true,
      imageUrl: data.data[0].url,
      revisedPrompt: data.data[0].revised_prompt
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error: ' + error.message 
    });
  }
});

// ===== AR SESSION ENDPOINTS =====

// Helper functions for AR sessions
function readARSessions() {
  try {
    const data = fs.readFileSync(arSessionsFile, 'utf8');
    return JSON.parse(data).sessions || [];
  } catch (error) {
    console.error('Error reading AR sessions:', error);
    return [];
  }
}

function writeARSessions(sessions) {
  try {
    fs.writeFileSync(arSessionsFile, JSON.stringify({ sessions }, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing AR sessions:', error);
    return false;
  }
}

// Save AR session
app.post('/api/ar/session', (req, res) => {
  try {
    const sessionData = req.body;
    
    // Validate session data
    if (!sessionData || !sessionData.sessionId) {
      return res.status(400).json({ error: 'Invalid session data' });
    }
    
    // Read existing sessions
    const sessions = readARSessions();
    
    // Add new session
    sessions.push({
      ...sessionData,
      savedAt: new Date().toISOString()
    });
    
    // Keep only last 1000 sessions (to prevent file from growing too large)
    const limitedSessions = sessions.slice(-1000);
    
    // Write back to file
    const success = writeARSessions(limitedSessions);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Session saved',
        totalSessions: limitedSessions.length
      });
    } else {
      res.status(500).json({ error: 'Failed to save session' });
    }
    
  } catch (error) {
    console.error('Error saving AR session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all AR sessions
app.get('/api/ar/sessions', (req, res) => {
  try {
    const sessions = readARSessions();
    
    res.json({ 
      success: true,
      sessions: sessions,
      totalSessions: sessions.length
    });
    
  } catch (error) {
    console.error('Error retrieving AR sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear all AR sessions (optional - for testing/admin)
app.delete('/api/ar/sessions', (req, res) => {
  try {
    const success = writeARSessions([]);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'All sessions cleared' 
      });
    } else {
      res.status(500).json({ error: 'Failed to clear sessions' });
    }
    
  } catch (error) {
    console.error('Error clearing AR sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Memory Generator server running on port ${PORT}`);
  console.log(`📷 Open http://localhost:${PORT} in your browser`);
  
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  WARNING: OPENAI_API_KEY environment variable is not set!');
    console.warn('   Create a .env file with: OPENAI_API_KEY=your-key-here');
  }
});
