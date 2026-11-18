'use strict';
// Tests must never read a personal staged map or production campaign namespace.
process.env.CAMPAIGN_MAP_DIR = require('node:path').resolve(__dirname, '../examples/demo-map');
process.env.CAMPAIGN_ID = 'demo-map';
delete process.env.CAMPAIGN_MAP_REQUIRED;
