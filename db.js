const mongoose = require('mongoose');
const { MONGO_URI } = require('./config');

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ MongoDB সংযুক্ত হয়েছে');
  } catch (err) {
    console.error('❌ MongoDB সংযোগে সমস্যা:', err.message);
    // don't exit here so dashboard can still run in dev
  }
};

module.exports = connectDB;
