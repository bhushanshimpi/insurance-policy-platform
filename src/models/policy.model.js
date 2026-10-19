// Policy info. user, lob, and carrier are collection ids. Agent and account are optional.
const mongoose = require('mongoose');

const policySchema = new mongoose.Schema(
  {
    policyNumber: { type: String, required: true, trim: true, maxlength: 100 },
    policyStartDate: { type: Date, required: true },
    policyEndDate: { type: Date, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lob: { type: mongoose.Schema.Types.ObjectId, ref: 'Lob', required: true },
    carrier: { type: mongoose.Schema.Types.ObjectId, ref: 'Carrier', required: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
    policyType: { type: String, trim: true, maxlength: 100 },
    premiumAmount: { type: Number },
    producer: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true, collection: 'policies' },
);

policySchema.index({ policyNumber: 1 }, { unique: true });
policySchema.index({ user: 1 });

module.exports = mongoose.model('Policy', policySchema);
