const express = require('express');
const { asyncHandler } = require('../../utils/async-handler');
const { validate } = require('../../middleware/validate');
const {
  createSchema,
  idSchema,
  createScheduledMessage,
  getScheduledMessage,
} = require('./scheduled-message.controller');

const router = express.Router();

router.post('/', validate({ body: createSchema }), asyncHandler(createScheduledMessage));
router.get('/:id', validate({ params: idSchema }), asyncHandler(getScheduledMessage));

module.exports = router;
