const { searchPolicies, aggregatePolicies } = require('./policy.service');

/**
 * Use: HTTP handler for policy search.
 * Payload: query username (string), page (number), limit (number). GET /api/policies/search.
 * Returns: 200 { matchMode, assumption, page, limit, total, results }.
 */
async function search(req, res) {
  res.status(200).json(await searchPolicies(req.query));
}

/**
 * Use: HTTP handler for policy counts per user.
 * Payload: query page (number), limit (number). GET /api/policies/aggregate.
 * Returns: 200 { page, limit, total, results: [{ userId, displayName, policyCount }] }.
 */
async function aggregate(req, res) {
  res.status(200).json(await aggregatePolicies(req.query));
}

module.exports = { search, aggregate };
