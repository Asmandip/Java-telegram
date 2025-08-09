import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection
const mongoClient = new MongoClient(process.env.MONGO_URI);
await mongoClient.connect();
const db = mongoClient.db("asman_trade_logs");

app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.send("🚀 AsmanDip Java Telegram Bot Server Running...");
});

// Example API: Send Telegram Message
app.post("/send-signal", async (req, res) => {
  try {
    const { pair, rsi } = req.body;

    // Save to MongoDB
    await db.collection("signals").insertOne({
      pair,
      rsi,
      time: new Date()
    });

    // Send to Telegram
    const message = `📢 Signal Alert\nPair: ${pair}\nRSI: ${rsi}\nTime: ${new Date().toLocaleString()}`;
    const telegramURL = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

    await fetch(telegramURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.CHAT_ID,
        text: message
      })
    });

    res.status(200).json({ success: true, message: "Signal sent to Telegram" });
  } catch (err) {
    console.error("Error sending signal:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});