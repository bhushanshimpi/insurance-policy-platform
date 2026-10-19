// firstName is indexed for search and is not unique. identityKey is the unique person key.
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 200 },
    normalizedFirstName: { type: String, required: true, trim: true, maxlength: 200 },
    identityKey: { type: String, required: true, maxlength: 300 },
    email: { type: String, trim: true, lowercase: true, maxlength: 320 },
    dob: { type: Date },
    address: { type: String, trim: true, maxlength: 500 },
    city: { type: String, trim: true, maxlength: 200 },
    state: { type: String, trim: true, maxlength: 100 },
    zip: { type: String, trim: true, maxlength: 20 },
    phone: { type: String, trim: true, maxlength: 40 },
    gender: { type: String, trim: true, maxlength: 50 },
    userType: { type: String, trim: true, maxlength: 100 },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ identityKey: 1 }, { unique: true });
userSchema.index({ normalizedFirstName: 1 });
userSchema.index({ email: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', userSchema);
