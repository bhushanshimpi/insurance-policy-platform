// Upserts one batch into Agent, User, Account, LOB, Carrier, and Policy.
// Parents are written before Policy so the policy document can store their ObjectIds.
// Repeating an import updates the same records because each entity has a stable unique key.
const Agent = require('../../models/agent.model');
const User = require('../../models/user.model');
const Account = require('../../models/account.model');
const Lob = require('../../models/lob.model');
const Carrier = require('../../models/carrier.model');
const Policy = require('../../models/policy.model');

/**
 * Use: keeps one item per key so one bulkWrite does not upsert the same document twice.
 * Payload: items (array), keyFn (function(item) => string).
 * Returns: an array of unique items. The last item wins.
 */
function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) map.set(keyFn(item), item);
  return [...map.values()];
}

/**
 * Use: upserts reference data and loads the saved documents so later rows can use their ids.
 * Payload: Model, operations (bulkWrite ops), filterValues (array), filterField (string).
 * Returns: Map from the key field to the document.
 */
async function upsertAndLoad(Model, operations, filterValues, filterField) {
  if (operations.length === 0) return new Map();
  await Model.bulkWrite(operations, { ordered: false });
  const docs = await Model.find({ [filterField]: { $in: filterValues } }).lean();
  return new Map(docs.map((doc) => [String(doc[filterField]), doc]));
}

/**
 * Use: writes one batch of valid policy rows and their related records.
 * Payload: rows (array of normalized rows with identityKey, policyNumber, and references).
 * Returns: { written }.
 */
async function writeImportBatch(rows) {
  const agents = uniqueBy(
    rows.filter((row) => row.agent),
    (row) => row.agent.toLowerCase(),
  ).map((row) => ({
    name: row.agent,
    normalizedName: row.agent.toLowerCase(),
  }));
  const lobs = uniqueBy(rows, (row) => row.categoryName.toLowerCase()).map((row) => ({
    categoryName: row.categoryName,
    normalizedName: row.categoryName.toLowerCase(),
  }));
  const carriers = uniqueBy(rows, (row) => row.companyName.toLowerCase()).map((row) => ({
    companyName: row.companyName,
    normalizedName: row.companyName.toLowerCase(),
  }));

  const [agentMap, lobMap, carrierMap] = await Promise.all([
    upsertAndLoad(
      Agent,
      agents.map((doc) => ({
        updateOne: {
          filter: { normalizedName: doc.normalizedName },
          update: {
            $set: { name: doc.name },
            $setOnInsert: { normalizedName: doc.normalizedName },
          },
          upsert: true,
        },
      })),
      agents.map((doc) => doc.normalizedName),
      'normalizedName',
    ),
    upsertAndLoad(
      Lob,
      lobs.map((doc) => ({
        updateOne: {
          filter: { normalizedName: doc.normalizedName },
          update: {
            $set: { categoryName: doc.categoryName },
            $setOnInsert: { normalizedName: doc.normalizedName },
          },
          upsert: true,
        },
      })),
      lobs.map((doc) => doc.normalizedName),
      'normalizedName',
    ),
    upsertAndLoad(
      Carrier,
      carriers.map((doc) => ({
        updateOne: {
          filter: { normalizedName: doc.normalizedName },
          update: {
            $set: { companyName: doc.companyName },
            $setOnInsert: { normalizedName: doc.normalizedName },
          },
          upsert: true,
        },
      })),
      carriers.map((doc) => doc.normalizedName),
      'normalizedName',
    ),
  ]);

  const users = uniqueBy(rows, (row) => row.identityKey);
  await User.bulkWrite(
    users.map((row) => {
      const set = {
        firstName: row.firstName,
        normalizedFirstName: row.normalizedFirstName,
        dob: row.dob,
        address: row.address,
        phone: row.phone,
        state: row.state,
        zip: row.zip,
        gender: row.gender,
        userType: row.userType,
        city: row.city,
      };
      if (row.email) set.email = row.email;
      return {
        updateOne: {
          filter: { identityKey: row.identityKey },
          update: { $set: set, $setOnInsert: { identityKey: row.identityKey } },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
  const userDocs = await User.find({
    identityKey: { $in: users.map((row) => row.identityKey) },
  }).lean();
  const userMap = new Map(userDocs.map((doc) => [doc.identityKey, doc]));

  const accounts = uniqueBy(
    rows.filter((row) => row.accountName),
    (row) => `${row.identityKey}|${row.accountName.toLowerCase()}`,
  );
  if (accounts.length > 0) {
    await Account.bulkWrite(
      accounts.map((row) => {
        const user = userMap.get(row.identityKey);
        return {
          updateOne: {
            filter: { user: user._id, normalizedName: row.accountName.toLowerCase() },
            update: {
              $set: { accountName: row.accountName },
              $setOnInsert: {
                user: user._id,
                normalizedName: row.accountName.toLowerCase(),
              },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }
  const accountDocs =
    accounts.length === 0
      ? []
      : await Account.find({
          user: {
            $in: [...new Set(accounts.map((row) => String(userMap.get(row.identityKey)._id)))],
          },
        }).lean();
  const accountMap = new Map(
    accountDocs.map((doc) => [`${String(doc.user)}|${doc.normalizedName}`, doc]),
  );

  await Policy.bulkWrite(
    rows.map((row) => {
      const user = userMap.get(row.identityKey);
      const account = row.accountName
        ? accountMap.get(`${String(user._id)}|${row.accountName.toLowerCase()}`)
        : null;
      const agent = row.agent ? agentMap.get(row.agent.toLowerCase()) : null;
      return {
        updateOne: {
          filter: { policyNumber: row.policyNumber },
          update: {
            $set: {
              policyStartDate: row.policyStartDate,
              policyEndDate: row.policyEndDate,
              user: user._id,
              lob: lobMap.get(row.categoryName.toLowerCase())._id,
              carrier: carrierMap.get(row.companyName.toLowerCase())._id,
              agent: agent ? agent._id : null,
              account: account ? account._id : null,
              policyType: row.policyType || undefined,
              premiumAmount: row.premiumAmount,
              producer: row.producer || undefined,
              city: row.city || undefined,
            },
            $setOnInsert: { policyNumber: row.policyNumber },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );

  return { written: rows.length };
}

module.exports = { writeImportBatch };
