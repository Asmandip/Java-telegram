import axios from 'axios';
import config from '../config/index.js';

export async function placeTrade(pair, side, amount) {
  console.log(`Placing trade on ${pair}: ${side} ${amount}`);
  return { success: true };
}