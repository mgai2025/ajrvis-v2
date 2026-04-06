const CONSTANTS = require('./src/config/constants');
require('dotenv').config({ path: './.env' });
console.log('ENV TELEGRAM_BOT_USERNAME:', process.env.TELEGRAM_BOT_USERNAME);
console.log('CONSTANTS TELEGRAM_BASE:', CONSTANTS.BOT_LINKS.TELEGRAM_BASE);
