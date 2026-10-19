// Policy carrier, keyed by company_name.
const mongoose = require('mongoose');

const carrierSchema = new mongoose.Schema(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 200 },
    normalizedName: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { timestamps: true, collection: 'carriers' },
);

carrierSchema.index({ normalizedName: 1 }, { unique: true });

module.exports = mongoose.model('Carrier', carrierSchema);
