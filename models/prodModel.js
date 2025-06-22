const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  title: { type: String, required: true },
  area: { type: String, required: true },
  length: { type: String, required: true },
  breadth: { type: String, required: true },
  shape: { type: String },
  soilColor: { type: String },
  location: { type: String, required: true },
  loanFacility: { type: Boolean, default: false },
  description: { type: String },
  ownerName: { type: String, required: true },
  ownerPhone: { type: String, required: true },
  ownerAadhar: { type: String, required: true },
  status: { type: String, enum: ['Under Review', 'Approved', 'Rejected'], default: 'Under Review' },
  images: [{ type: String }],
  video: { type: String },
  documents: [{ type: String }],
  uploadedAt: { type: Date, default: Date.now },
  tag: { type: String },
  price: { type: String, required: true },
  ownerId: { type:String, required: true },
}, {
  timestamps: true // adds createdAt and updatedAt fields
});

module.exports = mongoose.model('Property', propertySchema);
