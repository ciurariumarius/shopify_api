require("dotenv").config();

const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Shopify API app is running");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "shopify_api"
  });
});

app.listen(PORT, () => {
  console.log(`shopify_api running on port ${PORT}`);
});
