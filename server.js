// Updated Backend Code with Mongoose and JWT (No Cookies)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const userRouter=require('./routes/userRoutes');
require('dotenv').config();

const User = require('./models/userModel');
const Property = require('./models/prodModel');

const JWT_SECRET = process.env.JWT_SECRET || 'your-very-secure-secret';
const app = express();

// Middleware
app.use(cors({ origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/',userRouter);

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ message: 'Invalid token' });
  }
};

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB");
  } catch (err) {
    console.error("Mongodb connected failed", err);
    process.exit(1);
  }
};

// MongoDB Connection with Mongoose


// Signup

// Get Current User
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ username: user.username, email: user.email, wishlist: user.wishlist || [], isadmin: user.isadmin });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Multer Setup
const uploadDir = path.join(__dirname, 'uploads');
const imageDir = path.join(uploadDir, 'images');
const videoDir = path.join(uploadDir, 'videos');
const documentDir = path.join(uploadDir, 'documents');
[uploadDir, imageDir, videoDir, documentDir].forEach(fs.ensureDirSync);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, imageDir);
    else if (file.mimetype.startsWith('video/')) cb(null, videoDir);
    else if (file.mimetype === 'application/pdf') cb(null, documentDir);
    else cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Upload Property
app.post('/api/properties', authMiddleware, upload.fields([{ name: 'images' }, { name: 'video', maxCount: 1 }, { name: 'documents' }]), async (req, res) => {
  try {
    const images = (req.files['images'] || []).map(f => `/uploads/images/${f.filename}`);
    const video = req.files['video'] ? `/uploads/videos/${req.files['video'][0].filename}` : null;
    const documents = (req.files['documents'] || []).map(f => `/uploads/documents/${f.filename}`);
    const property = new Property({
      ...req.body,
      ownerId: req.user.id,
      loanFacility: req.body.loanFacility === 'true',
      images,
      video,
      documents,
      status: 'Under Review',
      uploadedAt: new Date()
    });
    await property.save();
    res.status(201).json({ message: 'Property uploaded successfully', property });
  } catch (err) {
    res.status(500).json({ message: 'Error uploading property' });
  }
});

// Get User Properties
app.get('/api/my-properties', authMiddleware, async (req, res) => {
  try {
   

    const properties = await Property.find({ ownerId: req.user.id });
    res.json(properties);
    
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch user properties' });
  }
});

// Get Approved Properties
app.get('/api/properties', async (req, res) => {
  try {
    const properties = await Property.find({ status: 'Approved' });
    res.json(properties);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch properties' });
  }
});

// Update Property
app.put('/api/property/:id', upload.fields([{ name: 'images' }, { name: 'video', maxCount: 1 }, { name: 'documents' }]), async (req, res) => {
  try {
    const id = req.params.id;
    const existingProperty = await Property.findById(id);
    if (!existingProperty) return res.status(404).json({ message: 'Property not found' });

    const { existingImages, existingVideo, existingDocuments } = req.body;
    const newImages = (req.files['images'] || []).map(f => `/uploads/images/${f.filename}`);
    const newVideo = req.files['video']?.[0] ? `/uploads/videos/${req.files['video'][0].filename}` : null;
    const newDocuments = (req.files['documents'] || []).map(f => `/uploads/documents/${f.filename}`);

    const updatedImages = JSON.parse(existingImages || '[]');
    const updatedDocs = JSON.parse(existingDocuments || '[]');

    for (const oldImg of existingProperty.images || []) if (!updatedImages.includes(oldImg)) fs.unlinkSync(path.join(__dirname, oldImg));
    for (const oldDoc of existingProperty.documents || []) if (!updatedDocs.includes(oldDoc)) fs.unlinkSync(path.join(__dirname, oldDoc));
    if (existingProperty.video && existingProperty.video !== existingVideo) fs.unlinkSync(path.join(__dirname, existingProperty.video));

    Object.assign(existingProperty, {
      ...req.body,
      loanFacility: req.body.loanFacility === 'true' || req.body.loanFacility === true,
      images: [...updatedImages, ...newImages],
      video: newVideo || existingVideo || null,
      documents: [...updatedDocs, ...newDocuments],
      status: req.body.status || 'Under Review',
      tag: req.body.tag || ''
    });

    await existingProperty.save();
    res.json({ message: 'Property updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while updating property' });
  }
});

// Delete Property
app.delete('/api/property/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ message: 'Property not found' });
    const mediaFiles = [...(property.images || []), ...(property.documents || [])];
    if (property.video) mediaFiles.push(property.video);
    await Promise.all(mediaFiles.map(file => fs.remove(path.join(__dirname, file))));
    await property.deleteOne();
    res.json({ message: 'Property deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while deleting property' });
  }
});

// Wishlist Toggle
app.post('/api/wishlist/:propertyId', authMiddleware, async (req, res) => {
  const { propertyId } = req.params;
  try {
    const user = await User.findById(req.user.id);
    const alreadyWishlisted = user.wishlist.includes(propertyId);
    if (alreadyWishlisted) {
      user.wishlist.pull(propertyId);
    } else {
      user.wishlist.push(propertyId);
    }
    await user.save();
    res.status(200).json({ message: alreadyWishlisted ? 'Removed from wishlist' : 'Added to wishlist' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get Wishlist
app.get('/api/wishlist', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const properties = await Property.find({ _id: { $in: user.wishlist } });
    res.json(properties);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch wishlist' });
  }
});

// Admin Review
app.get('/api/admin/review-properties', authMiddleware, async (req, res) => {
  if (!req.user) return res.status(403).json({ message: 'Access denied' });
  try {
    const underReview = await Property.find({ status: 'Under Review' });
    res.json(underReview);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch review properties' });
  }
});

app.post('/api/admin/review-properties/:id', authMiddleware, async (req, res) => {
  if (!req.user.isadmin) return res.status(403).json({ message: 'Access denied' });
  const { status, remarks, tag } = req.body;
  if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ message: 'Invalid status value' });
  try {
    await Property.findByIdAndUpdate(req.params.id, { status, remarks, tag });
    res.json({ message: 'Property updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error updating property review status' });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
connectDB();

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
