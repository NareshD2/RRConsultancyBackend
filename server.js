const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const fs = require('fs-extra'); // ✅ not just 'fs'

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secure-secret';
const cookieParser = require('cookie-parser');
const { ObjectId } = require('mongodb');



require('dotenv').config();

const app = express();


// Middleware
app.use(cors({
  origin: 'http://localhost:3000',  // frontend origin
  credentials: true 
}));
app.use(cookieParser());
app.use(express.json()); // to parse JSON request bodies

// MongoDB Atlas connection URI

const PORT = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let usersCollection;
let propertiesCollection;
let adminsCollection;
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Invalid token' });
  }
};


async function connectToDatabase() {
  try {
    await client.connect();
    const db = client.db('rrconsultancy'); // change to your DB
    usersCollection = db.collection('users');
    propertiesCollection = db.collection('properties');
    adminsCollection=db.collection('admins');
    console.log('Connected to MongoDB Atlas');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
  }
}

// API: Signup
app.post('/api/signup', async (req, res) => {
  const { username, email, password, phonenumber } = req.body;

  if (!username || !email || !password || !phonenumber) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const existingUser = await usersCollection.findOne({ email });

    if (existingUser) {
      return res.status(409).json({ message: 'User already exists' });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = {
      username,
      email,
      password: hashedPassword, // Store hashed password
      phonenumber,
      wishlist: [],
    };

    await usersCollection.insertOne(newUser);
    res.status(201).json({ message: 'Signup successful' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// API: Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ message: 'Invalid credentials' });

    // Create JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email, username: user.username,isadmin:user.isadmin},
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Send as HttpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: false,        // set true in production (HTTPS only)
      sameSite: 'Lax',  // prevent CSRFs
      maxAge: 24 * 60 * 60 * 1000
    });

    // Also send minimal user info if needed
    res.status(200).json({ message: 'Login successful', user: { email: user.email, username: user.username } });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const userDoc = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });

    if (!userDoc) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({
      username: userDoc.username,
      email: userDoc.email,
      wishlist: userDoc.wishlist || [],
      isadmin:userDoc.isadmin,
    });
  } catch (err) {
    console.error('/api/me error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});



// Ensure upload folders exist
const uploadDir = path.join(__dirname, 'uploads');
const imageDir = path.join(uploadDir, 'images');
const videoDir = path.join(uploadDir, 'videos');
const documentDir = path.join(uploadDir, 'documents');

[uploadDir, imageDir, videoDir, documentDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, imageDir);
    else if (file.mimetype.startsWith('video/')) cb(null, videoDir);
    else if (file.mimetype === 'application/pdf') cb(null, documentDir);
    else cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage: storage });

app.post('/api/properties',authMiddleware, upload.fields([
  { name: 'images' },
  { name: 'video', maxCount: 1 },
  { name: 'documents' }
]), async (req, res) => {
  try {
    const formData = req.body;

    const images = (req.files['images'] || []).map(file => `/uploads/images/${file.filename}`);
    const video = req.files['video'] ? `/uploads/videos/${req.files['video'][0].filename}` : null;
    const documents = (req.files['documents'] || []).map(file => `/uploads/documents/${file.filename}`);

    const property = {
      ...formData,
      ownerId: req.user.id,
      loanFacility: formData.loanFacility === 'true',
      images,
      video,
      documents,
      status: 'Under Review',
      uploadedAt: new Date()
    };

    await propertiesCollection.insertOne(property);

    res.status(201).json({ message: 'Property uploaded successfully', property });
  } catch (err) {
    console.error('Error uploading property:', err);
    res.status(500).json({ message: 'Error uploading property' });
  }
});
app.get('/api/my-properties', authMiddleware, async (req, res) => {
  try {
    const properties = await propertiesCollection
      .find({ ownerId: req.user.id })
      .toArray();
    res.json(properties);
    
  } catch (err) {
    console.error('Error fetching user properties:', err);
    res.status(500).json({ message: 'Failed to fetch user properties' });
  }
});


// Get approved properties
app.get('/api/properties',async (req, res) => {
  try {
    const properties = await propertiesCollection.find({ status: 'Approved' }).toArray();
    res.json(properties);
  } catch (err) {
    console.error('Error fetching properties:', err);
    res.status(500).json({ message: 'Failed to fetch properties' });
  }
});
app.get('/property/:id',authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const property = await Property.findById(id);
    if (!property) return res.status(404).json({ message: 'Property not found' });
    res.json(property);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.put('/api/property/:id',
  upload.fields([
    { name: 'images', maxCount: 100 },
    { name: 'video', maxCount: 1 },
    { name: 'documents', maxCount: 5 }
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { ObjectId } = require('mongodb');
      const existingProperty = await propertiesCollection.findOne({ _id: new ObjectId(id) });

      if (!existingProperty) return res.status(404).json({ message: 'Property not found' });

      const {
        title,
        area,
        length,
        breadth,
        shape,
        soilColor,
        price,
        location,
        description,
        loanFacility,
        ownerName,
        ownerPhone,
        ownerAadhar,
        existingImages,
        existingVideo,
        existingDocuments
      } = req.body;

      const newImages = (req.files['images'] || []).map(f => `/uploads/images/${f.filename}`);
      const newVideo = req.files['video']?.[0] ? `/uploads/videos/${req.files['video'][0].filename}` : null;
      const newDocuments = (req.files['documents'] || []).map(f => `/uploads/documents/${f.filename}`);

      const updatedImages = JSON.parse(existingImages || '[]');
      const updatedDocs = JSON.parse(existingDocuments || '[]');

      // Delete removed images
      for (const oldImg of existingProperty.images || []) {
        if (!updatedImages.includes(oldImg)) fs.unlinkSync(path.join(__dirname, oldImg));
      }
      for (const oldDoc of existingProperty.documents || []) {
        if (!updatedDocs.includes(oldDoc)) fs.unlinkSync(path.join(__dirname, oldDoc));
      }
      if (existingProperty.video && existingProperty.video !== existingVideo) {
        fs.unlinkSync(path.join(__dirname, existingProperty.video));
      }

      await propertiesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            title,
            area,
            length,
            breadth,
            shape,
            soilColor,
            price,
            location,
            description,
            loanFacility: loanFacility === 'true' || loanFacility === true,
            ownerName,
            ownerPhone,
            ownerAadhar,
            images: [...updatedImages, ...newImages],
            video: newVideo || existingVideo || null,
            documents: [...updatedDocs, ...newDocuments],
            status: req.body.status || 'Under Review',
            tag:req.body.tag || '',
          },
        }
      );

      res.json({ message: 'Property updated successfully' });
    } catch (err) {
      console.error('Update failed:', err);
      res.status(500).json({ message: 'Server error while updating property' });
    }
  }
);

app.delete('/api/property/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const property = await propertiesCollection.findOne({ _id: new ObjectId(id) });
    if (!property) return res.status(404).json({ message: 'Property not found' });

    // Collect all media files into a single array (filter out null)
    const mediaFiles = [...(property.images || []), ...(property.documents || [])];
    if (property.video) mediaFiles.push(property.video);

    // Delete media files from disk (use async/await for fs-extra)
    await Promise.all(
      mediaFiles.map(file => fs.remove(path.join(__dirname, '..', file)))
    );

    // Delete property from database
    await propertiesCollection.deleteOne({ _id: new ObjectId(id)});

    res.json({ message: 'Property deleted successfully' });
  } catch (err) {
    console.error('Delete failed:', err);
    res.status(500).json({ message: 'Server error while deleting property' });
  }
});
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', {
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
  path: '/',
}); // or the name you used when setting the cookie
  res.status(200).json({ message: 'Logged out successfully' });
});
// POST: Add/Remove property from wishlist
app.post('/api/wishlist/:propertyId', authMiddleware, async (req, res) => {
  const { propertyId } = req.params;
  const userId = req.user.id;
  const { ObjectId } = require('mongodb');

  try {
    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

    if (!user) return res.status(404).json({ message: 'User not found' });

    // Correct comparison: convert ObjectId to string
    const alreadyWishlisted = user.wishlist?.some(
      id => id.toString() === propertyId
    );

    const updateOp = alreadyWishlisted
      ? { $pull: { wishlist: new ObjectId(propertyId) } }
      : { $addToSet: { wishlist: new ObjectId(propertyId) } };

    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      updateOp
    );

    res.status(200).json({
      message: alreadyWishlisted ? 'Removed from wishlist' : 'Added to wishlist',
    });
  } catch (err) {
    console.error('Wishlist update failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


app.get('/api/wishlist', authMiddleware, async (req, res) => {
  const { ObjectId } = require('mongodb');
  try {
    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });

    if (!user || !user.wishlist || user.wishlist.length === 0) {
      return res.json([]);
    }

    const wishlistedProperties = await propertiesCollection
      .find({ _id: { $in: user.wishlist.map(id => new ObjectId(id)) } })
      .toArray();

    res.json(wishlistedProperties);
  } catch (err) {
    console.error('Error fetching wishlist:', err);
    res.status(500).json({ message: 'Failed to fetch wishlist' });
  }
});
app.post('/api/admin', async (req, res) => {
  const { email, password } = req.body;
   try{
     const user=await adminsCollection.findOne({email});
     if(!user){
      return res.status(400).json({message:"Invalid credentials"});

     }
     const vp=await bcrypt.compare(password,user.password);
     if(!user){
      return res.status(400).json({message:"Invalid credentials"});
     
     }
     const token=jwt.sign(
       {id:user._id,email:user.email,username:user.username},
       JWT_SECRET,
       { expiresIn: '1h' }
     );
     res.cookie(token,{
      httpOnly:true,
      secure:false,
      sameSite:'Lax',
      maxAge:3600000
     });
     res.status(200).json({message:"login successful"});

   }catch(err){
      res.status(500).json({message:"server error"});
   }
  
});
// GET all properties with status 'Under Review'
app.get('/api/admin/review-properties',authMiddleware, async (req, res) => {
  try {
    const user = req.user; // Ensure user is extracted from middleware

    if (!user || user.isadmin!== true) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const underReview = await propertiesCollection.find({ status: 'Under Review' }).toArray();
    res.json(underReview);
  
  } catch (error) {
    res.status(500).json({ message: 'Error fetching properties', error });
  }
});

// POST: Admin approves or rejects a property
app.post('/api/admin/review-properties/:id',authMiddleware, async (req, res) => {
  try {
    const { status, remarks, tag } = req.body;
    const user = req.user;

    if (!user || user.isadmin!== true) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    const updated = await propertiesCollection.findByIdAndUpdate(
      req.params.id,
      { status, remarks, tag },
      { new: true }
    );

    res.json({ message: 'Property updated successfully', updated });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update property', err });
  }
});





// Start server after DB connection
connectToDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
