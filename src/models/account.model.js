// A user's account. The same account name for two users is two accounts.
const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    accountName: { type: String, required: true, trim: true, maxlength: 200 },
    normalizedName: { type: String, required: true, trim: true, maxlength: 200 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'accounts' },
);

accountSchema.index({ user: 1, normalizedName: 1 }, { unique: true });

module.exports = mongoose.model('Account', accountSchema);
