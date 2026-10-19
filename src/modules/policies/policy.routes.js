const express = require('express');
const { asyncHandler } = require('../../utils/async-handler');
const { validate } = require('../../middleware/validate');
const { searchQuerySchema, aggregateQuerySchema } = require('./policy.service');
const { search, aggregate } = require('./policy.controller');

const router = express.Router();

router.get('/search', validate({ query: searchQuerySchema() }), asyncHandler(search));
router.get('/aggregate', validate({ query: aggregateQuerySchema() }), asyncHandler(aggregate));

module.exports = router;
