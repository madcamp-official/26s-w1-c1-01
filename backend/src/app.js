import express from "express";
import cors from "cors";
import countriesRouter from "./routes/countries.js";
import citiesRouter from "./routes/cities.js";

export function createApp() {
  const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const app = express();

  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    })
  );

  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use("/countries", countriesRouter);
  app.use("/cities", citiesRouter);

  app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}
