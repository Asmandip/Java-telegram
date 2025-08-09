import mongoose from 'mongoose';

const signalSchema = new mongoose.Schema({
  pair: String,
  type: String,
  price: Number,
  confidence: Number,
  indicators: Object,
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Signal', signalSchema);