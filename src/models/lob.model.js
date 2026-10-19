// Policy category (LOB), keyed by category_name.
const mongoose = require('mongoose');

const lobSchema = new mongoose.Schema(
  {
    categoryName: { type: String, required: true, trim: true, maxlength: 200 },
    normalizedName: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { timestamps: true, collection: 'lobs' },
);

lobSchema.index({ normalizedName: 1 }, { unique: true });

module.exports = mongoose.model('Lob', lobSchema);
