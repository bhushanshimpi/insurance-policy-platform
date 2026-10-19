// Search treats "username" as firstname. The sheet has no separate username column,
// and the match is case-insensitive equality, not a user-supplied regular expression.
// Populate needs these models registered in the API process, not only in the import worker.
const { z } = require('zod');
require('../../models/agent.model');
require('../../models/account.model');
require('../../models/lob.model');
require('../../models/carrier.model');
const Policy = require('../../models/policy.model');
const User = require('../../models/user.model');
const { getEnv } = require('../../config/env');

/**
 * Use: builds the query schema for policy search.
 * Payload: none. Reads page limits from the environment.
 * Returns: a Zod schema for { username, page, limit }.
 */
function searchQuerySchema() {
  const env = getEnv();
  return z.object({
    username: z.string().trim().min(1).max(200),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(env.SEARCH_MAX_LIMIT)
      .default(env.SEARCH_DEFAULT_LIMIT),
  });
}

/**
 * Use: builds the query schema for policy aggregation.
 * Payload: none.
 * Returns: a Zod schema for { page, limit }.
 */
function aggregateQuerySchema() {
  const env = getEnv();
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(env.AGGREGATE_MAX_LIMIT)
      .default(env.AGGREGATE_DEFAULT_LIMIT),
  });
}

/**
 * Use: returns policy info without address, phone, or date of birth.
 * Payload: policy (lean Policy with populated agent, account, lob, and carrier).
 * Returns: { id, policyNumber, policyStartDate, policyEndDate, policyType, premiumAmount, agent, account, category, carrier }.
 */
function presentPolicy(policy) {
  return {
    id: String(policy._id),
    policyNumber: policy.policyNumber,
    policyStartDate: policy.policyStartDate,
    policyEndDate: policy.policyEndDate,
    policyType: policy.policyType || null,
    premiumAmount: policy.premiumAmount ?? null,
    agent: policy.agent ? { id: String(policy.agent._id), name: policy.agent.name } : null,
    account: policy.account
      ? { id: String(policy.account._id), accountName: policy.account.accountName }
      : null,
    category: policy.lob
      ? { id: String(policy.lob._id), categoryName: policy.lob.categoryName }
      : null,
    carrier: policy.carrier
      ? { id: String(policy.carrier._id), companyName: policy.carrier.companyName }
      : null,
  };
}

/**
 * Use: finds users by first name and returns each user's policies separately.
 * Payload: query { username, page, limit }.
 * Returns: { matchMode, assumption, page, limit, total, results }.
 */
async function searchPolicies(query) {
  const env = getEnv();
  const username = query.username.trim().toLowerCase();
  const page = query.page;
  const limit = query.limit;
  const filter = { normalizedFirstName: username };
  const total = await User.countDocuments(filter);
  const users = await User.find(filter)
    .sort({ _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('firstName')
    .lean();

  const results = [];
  for (const user of users) {
    const policies = await Policy.find({ user: user._id })
      .sort({ policyNumber: 1 })
      .limit(env.POLICIES_PER_USER_LIMIT)
      .populate('agent', 'name')
      .populate('account', 'accountName')
      .populate('lob', 'categoryName')
      .populate('carrier', 'companyName')
      .lean();
    results.push({
      user: { id: String(user._id), firstName: user.firstName },
      policies: policies.map(presentPolicy),
    });
  }

  return {
    matchMode: 'firstname',
    assumption:
      'username is matched to User.firstname with case-insensitive equality. First names are not unique, so each matching user is returned separately.',
    page,
    limit,
    total,
    results,
  };
}

/**
 * Use: counts policies for each user. A missing user is labeled Unknown.
 * Payload: query { page, limit }.
 * Returns: { page, limit, total, results: [{ userId, displayName, policyCount }] }.
 */
async function aggregatePolicies(query) {
  const page = query.page;
  const limit = query.limit;
  const skip = (page - 1) * limit;
  const [facet] = await Policy.aggregate([
    { $group: { _id: '$user', policyCount: { $sum: 1 } } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $sort: { policyCount: -1, _id: 1 } },
    {
      $facet: {
        results: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              userId: '$_id',
              displayName: { $ifNull: ['$user.firstName', 'Unknown'] },
              policyCount: 1,
            },
          },
        ],
        meta: [{ $count: 'total' }],
      },
    },
  ]);

  const results = (facet?.results || []).map((row) => ({
    userId: row.userId ? String(row.userId) : null,
    displayName: row.displayName,
    policyCount: row.policyCount,
  }));

  return {
    page,
    limit,
    total: facet?.meta?.[0]?.total || 0,
    results,
  };
}

module.exports = {
  searchQuerySchema,
  aggregateQuerySchema,
  searchPolicies,
  aggregatePolicies,
};
