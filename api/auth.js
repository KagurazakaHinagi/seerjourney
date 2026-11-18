'use strict';

const { createAPI } = require('../src/server/campaign.cjs');
module.exports = createAPI().auth;
