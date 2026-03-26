// This single file is the Vercel Edge entry point!
// It securely imports the entire Express Application and securely exports it without activating listeners.
const app = require('../src/app');

module.exports = app;
