const express = require("express");
const path = require("path");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Dashboard Route
app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// API Route to fetch prices from Bitget
app.get("/api/prices", async (req, res) => {
    try {
        const response = await axios.get("https://api.bitget.com/api/v2/market/tickers", {
            params: { productType: "umcbl" } // USDT-M Futures pairs
        });

        const tickers = response.data.data || [];
        const formatted = tickers.map(t => ({
            symbol: t.symbol,
            price: parseFloat(t.lastPr),
            change24h: parseFloat(t.change24h)
        }));

        res.json(formatted);
    } catch (error) {
        console.error("Error fetching Bitget prices:", error.message);
        res.status(500).json({ error: "Failed to fetch prices" });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 সার্ভার চালু হয়েছে পোর্ট ${PORT} তে`);
});