// The sheet has an agent name and no agent id, so the same normalized name is one agent.
const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    normalizedName: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { timestamps: true, collection: 'agents' },
);

agentSchema.index({ normalizedName: 1 }, { unique: true });

module.exports = mongoose.model('Agent', agentSchema);
