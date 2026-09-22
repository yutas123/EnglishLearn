import dotenv from "dotenv";

dotenv.config();

// Database
export const DATABASE_URL = process.env.DATABASE_URL;

// Genius API
export const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;

// OpenAI API
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ScraperAPI
export const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY;

// Spotify API
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
export const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

// Vercel revalidate
export const VERCEL_REVALIDATE_URL = process.env.VERCEL_REVALIDATE_URL;
export const VERCEL_REVALIDATE_SECRET = process.env.VERCEL_REVALIDATE_SECRET;
